import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import mongoose from 'mongoose';

const User = mongoose.model('User');

module.exports = () => {
  // Use local strategy
  passport.use(new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password',
  },
  (username, password, done) => {
    User.findOne({
      username: username.toLowerCase(),
    }, (err, user) => {
      if (err) {
        return done(err);
      }
      if (!user || !user.authenticate(password)) {
        return done(null, false, {
          message: 'Invalid username or password',
        });
      }

      return done(null, user);
    });
  }));
};
