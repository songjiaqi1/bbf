
const Books = require('../models/Book');

class BooksController {
    async actionCreate(ctx, next) {
      // const model = new Books();
      // const result = await model.createBook();

      ctx.body = await ctx.render('books/create', {

      });
    }
    async actionIndex(ctx, next) {
      const model = new Books();
      
      const result = await model.getList();
      ctx.body = await ctx.render('books/list', {
        result: result
      });
  }
}

module.exports = BooksController;