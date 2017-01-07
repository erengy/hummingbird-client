import Component from 'ember-component';
import service from 'ember-service/inject';
import get from 'ember-metal/get';
import set from 'ember-metal/set';
import observer from 'ember-metal/observer';
import { task } from 'ember-concurrency';
import { invokeAction } from 'ember-invoke-action';
import { isEmpty } from 'ember-utils';
import { modelType } from 'client/helpers/model-type';
import getter from 'client/utils/getter';

export default Component.extend({
  classNames: ['d-inline'],
  isLiked: false,
  showUsers: false,

  session: service(),
  store: service(),
  metrics: service(),

  resourceFilterKey: getter(function() {
    return `${modelType([get(this, 'resource')])}_id`;
  }),

  resourceLikeType: getter(function() {
    return `${modelType([get(this, 'resource')])}-like`;
  }),

  getLikes: task(function* () {
    const key = get(this, 'resourceFilterKey');
    return yield get(this, 'store').query(get(this, 'resourceLikeType'), {
      filter: { [key]: get(this, 'resource.id') },
      page: { limit: 4 },
      include: 'user'
    }).then((likes) => {
      set(this, 'likes', likes.toArray());
      set(this, 'likes.links', get(likes, 'links'));

      // look up session users like status if authenticated
      if (get(this, 'session.isAuthenticated') === true) {
        const like = likes.findBy('user.id', get(this, 'session.account.id'));
        if (like === undefined) {
          if (get(likes, 'length') >= 4) {
            this._getStatus();
          }
        } else {
          set(this, 'isLiked', true);
        }
      }
    }).catch(() => {});
  }).drop(),

  getLocalLike: task(function* () {
    const key = get(this, 'resourceFilterKey');
    return yield get(this, 'store').query(get(this, 'resourceLikeType'), {
      filter: { [key]: get(this, 'resource.id'), user_id: get(this, 'session.account.id') }
    });
  }).drop(),

  createLike: task(function* () {
    const key = modelType([get(this, 'resource')]);
    const like = get(this, 'store').createRecord(get(this, 'resourceLikeType'), {
      [key]: get(this, 'resource'),
      user: get(this, 'session.account')
    });

    // provide instant feedback to user
    get(this, 'likes').addObject(like);
    set(this, 'isLiked', true);
    invokeAction(this, 'likesCountUpdate', get(this, 'likesCount') + 1);

    // commit and handle error
    yield like.save().then(() => {
      invokeAction(this, 'onCreate');
      get(this, 'metrics').trackEvent({ category: key, action: 'like', value: get(this, 'resource.id') });
    }).catch(() => {
      get(this, 'likes').removeObject(like);
      set(this, 'isLiked', false);
      invokeAction(this, 'likesCountUpdate', get(this, 'likesCount') - 1);
    });
  }).drop(),

  destroyLike: task(function* () {
    const like = get(this, 'likes').findBy('user.id', get(this, 'session.account.id'));

    // instant feedback
    set(this, 'isLiked', false);
    invokeAction(this, 'likesCountUpdate', get(this, 'likesCount') - 1);

    // commit and handle error
    yield like.destroyRecord().then(() => {
      get(this, 'likes').removeObject(like);
    }).catch(() => {
      set(this, 'isLiked', true);
      invokeAction(this, 'likesCountUpdate', get(this, 'likesCount') + 1);
    });
  }).drop(),

  didReceiveAttrs({ newAttrs, oldAttrs }) {
    this._super(...arguments);
    if (isEmpty(oldAttrs) || get(newAttrs.resource.value, 'id') !== get(oldAttrs.resource.value, 'id')) {
      this._getLikes();
    }
  },

  _getLikes() {
    set(this, 'likes', []);
    set(this, 'isLiked', false);
    if (get(this, 'likesCount') > 0) {
      get(this, 'getLikes').perform();
    }
  },

  _getStatus() {
    get(this, 'getLocalLike').perform().then((records) => {
      const record = get(records, 'firstObject');
      if (record !== undefined) {
        set(record, 'user', get(this, 'session.account'));
        get(this, 'likes').addObject(record);
        set(this, 'isLiked', true);
      }
    }).catch(() => {});
  },

  _didAuthenticate: observer('session.hasUser', function() {
    this._getLikes();
  }),

  actions: {
    toggleLike() {
      if (get(this, 'session.hasUser') === false) {
        return get(this, 'session.signUpModal')();
      }

      if (get(this, 'createLike.isRunning') || get(this, 'destroyLike.isRunning')) {
        return;
      }

      const isLiked = get(this, 'isLiked');
      if (isLiked === true) {
        get(this, 'destroyLike').perform();
      } else {
        get(this, 'createLike').perform();
      }
    },

    toggleModal() {
      if (get(this, 'likesCount') > 0) {
        this.toggleProperty('modalOpen');
      }
    }
  }
});
