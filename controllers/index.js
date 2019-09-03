const router = require('koa-simple-router');

const SiteController = require('./indexController');
const indexController = new SiteController();

const BooksController = require('./booksController');
const booksController = new BooksController();

const initController = (app) => {
  app.use(router(_ => {
    _.get('/', indexController.actionIndex);

    _.get('/books/list', booksController.actionIndex);

    _.get('/books/create', booksController.actionCreate);
  }));
}


module.exports = initController;