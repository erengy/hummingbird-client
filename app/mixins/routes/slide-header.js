import Mixin from 'ember-metal/mixin';
import jQuery from 'jquery';

export default Mixin.create({
  activate() {
    this._super(...arguments);
    jQuery('body').addClass('slide-header');
  },

  deactivate() {
    this._super(...arguments);
    jQuery('body').removeClass('slide-header');
  }
});
