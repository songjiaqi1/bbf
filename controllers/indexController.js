const Controller = require('./basicController');

class SiteController extends Controller {
  constructor(app) {
    super();
    this.app = app;
  }

  // root page
  async actionIndex(ctx, next) {
    ctx.body = await ctx.render('index/index');
  }

  actionGetBook() {

  }
}

module.exports = SiteController;