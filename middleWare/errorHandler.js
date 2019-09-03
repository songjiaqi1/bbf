

let errorHandler = {
  error(app, logger) {
    app.use(async (ctx, next) => {
      try{
        await next();
      } catch {
        ctx.body = '🙅，项目出错';
        logger.error('');
      }  
    });

     app.use(async (ctx, next) => {
       await next()
       if (404 == ctx.status) {
        ctx.body = 'asaw';
       }
     });
  }
}
module.exports = errorHandler;