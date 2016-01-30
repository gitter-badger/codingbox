/**
 * Module dependencies
 */
import errorHandler from '../../helpers/errors.helper';
import mongoose from 'mongoose';
import passport from 'passport';
const User = mongoose.model('User');

// URLs for which user can't be redirected on signin
const noReturnUrls = [
  '/login',
  '/register',
];

/**
 * Signup
 */
exports.signup = function signup(req, res) {
  // For security measurement we remove the roles from the req.body object
  delete req.body.roles; // eslint-disable-line

  // Init user and add missing fields
  const user = new User(req.body);
  user.provider = 'local';
  user.displayName = `${user.firstName} ${user.lastName}`;

  // Then save the user
  user.save((err) => {
    if (err) {
      return res.status(400).send({
        message: errorHandler.getErrorMessage(err),
      });
    }

    // Remove sensitive data before login
    user.password = undefined;
    user.salt = undefined;

    req.login(user, (err) => { // eslint-disable-line
      if (err) {
        res.status(400).send(err);
      } else {
        res.json(user);
      }
    });
  });
};

/**
 * Signin after passport authentication
 */
exports.signin = function signin(req, res, next) {
  passport.authenticate('local', (err, user, info) => {
    if (err || !user) {
      res.status(400).send(info);
    } else {
      // Remove sensitive data before login
      user.password = undefined; // eslint-disable-line
      user.salt = undefined; // eslint-disable-line

      req.login(user, (err) => { // eslint-disable-line
        if (err) {
          res.status(400).send(err);
        } else {
          res.json(user);
        }
      });
    }
  })(req, res, next);
};

/**
 * Signout
 */
exports.signout = function signout(req, res) {
  req.logout();
  res.redirect('/');
};

/**
 * OAuth provider call
 */
exports.oauthCall = function oauthCall(strategy, scope) {
  return (req, res, next) => {
    // Set redirection path on session.
    // Do not redirect to a signin or signup page
    if (noReturnUrls.indexOf(req.query.redirect_to) === -1) {
      req.session.redirect_to = req.query.redirect_to; // eslint-disable-line
    }
    // Authenticate
    passport.authenticate(strategy, scope)(req, res, next);
  };
};

/**
 * OAuth callback
 */
exports.oauthCallback = function oauthCallback(strategy) {
  return (req, res, next) => {
    // Pop redirect URL from session
    const sessionRedirectURL = req.session.redirect_to;
    delete req.session.redirect_to; // eslint-disable-line

    passport.authenticate(strategy, (err, user, redirectURL) => {
      if (err) {
        return res.redirect(`/login?err=${encodeURIComponent(
            errorHandler.getErrorMessage(err))
          }`);
      }
      if (!user) {
        return res.redirect('/login');
      }
      req.login(user, (err) => { // eslint-disable-line
        if (err) {
          return res.redirect('/login');
        }

        return res.redirect(redirectURL || sessionRedirectURL || '/');
      });
    })(req, res, next);
  };
};

/**
 * Helper function to save or update a OAuth user profile
 */
exports.saveOAuthUserProfile = function saveOAuthUserProfile(req, providerUserProfile, done) {
  if (!req.user) {
    // Define a search query fields
    const searchMainProviderIdentifierField =
      `providerData.${providerUserProfile.providerIdentifierField}`;
    const searchAdditionalProviderIdentifierField =
      `additionalProvidersData.${
        providerUserProfile.provider
      }.${
        providerUserProfile.providerIdentifierField
      }`;

    // Define main provider search query
    const mainProviderSearchQuery = {};
    mainProviderSearchQuery.provider = providerUserProfile.provider;
    mainProviderSearchQuery[searchMainProviderIdentifierField] =
      providerUserProfile.providerData[providerUserProfile.providerIdentifierField];

    // Define additional provider search query
    const additionalProviderSearchQuery = {};
    additionalProviderSearchQuery[searchAdditionalProviderIdentifierField] =
      providerUserProfile.providerData[providerUserProfile.providerIdentifierField];

    // Define a search query to find existing user with current provider profile
    const searchQuery = {
      $or: [mainProviderSearchQuery, additionalProviderSearchQuery],
    };

    User.findOne(searchQuery, (err, user) => {
      if (err) {
        return done(err);
      }

      if (!user) {
        const possibleUsername =
          providerUserProfile.username ||
          ((providerUserProfile.email) ? providerUserProfile.email.split('@')[0] : '');

        User.findUniqueUsername(possibleUsername, null, (availableUsername) => {
          user = new User({ // eslint-disable-line
            firstName: providerUserProfile.firstName,
            lastName: providerUserProfile.lastName,
            username: availableUsername,
            displayName: providerUserProfile.displayName,
            email: providerUserProfile.email,
            profileImageURL: providerUserProfile.profileImageURL,
            provider: providerUserProfile.provider,
            providerData: providerUserProfile.providerData,
          });

          // And save the user
          user.save((err) => { // eslint-disable-line
            return done(err, user);
          });
        });
      } else {
        return done(err, user);
      }
    });
  } else {
    // User is already logged in, join the provider data to the existing user
    const user = req.user;

    // Check if user exists, is not signed in using this provider,
    // and doesn't have that provider data already configured
    if (user.provider !== providerUserProfile.provider &&
        (
         !user.additionalProvidersData ||
         !user.additionalProvidersData[providerUserProfile.provider]
        )
       ) {
      // Add the provider data to the additional provider data field
      if (!user.additionalProvidersData) {
        user.additionalProvidersData = {};
      }

      user.additionalProvidersData[providerUserProfile.provider] = providerUserProfile.providerData;

      // Then tell mongoose that we've updated the additionalProvidersData field
      user.markModified('additionalProvidersData');

      // And save the user
      user.save((err) => done(err, user, '/settings/accounts'));
    } else {
      return done(new Error('User is already connected using this provider'), user);
    }
  }
};

/**
 * Remove OAuth provider
 */
exports.removeOAuthProvider = function removeOAuthProvider(req, res, next) { // eslint-disable-line
  const user = req.user;
  const provider = req.query.provider;

  if (!user) {
    return res.status(401).json({
      message: 'User is not authenticated',
    });
  } else if (!provider) {
    return res.status(400).send();
  }

  // Delete the additional provider
  if (user.additionalProvidersData[provider]) {
    delete user.additionalProvidersData[provider];

    // Then tell mongoose that we've updated the additionalProvidersData field
    user.markModified('additionalProvidersData');
  }

  user.save((err) => {
    if (err) {
      return res.status(400).send({
        message: errorHandler.getErrorMessage(err),
      });
    }

    req.login(user, (err) => { // eslint-disable-line
      if (err) {
        return res.status(400).send(err);
      }

      return res.json(user);
    });
  });
};
