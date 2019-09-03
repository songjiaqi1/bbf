const Koa = require('koa');
const config = require('./config/index');
const initController = require('./controllers/index');
var render = require('koa-swig');
const server = require('koa-static');
const errorHandler = require('./middleWare/errorHandler');
const log4js = require('log4js');
log4js.configure({
  appenders: { cheese: { type: 'file', filename: __dirname + '/log/log.log' } },
  categories: { default: { appenders: ['cheese'], level: 'error' } }
});

const logger = log4js.getLogger('cheese');

var co = require('co');
const app = new Koa();
app.use(server(config.staticPath));
app.context.render = co.wrap(render({
  root: config.viewPath,
  autoescape: true,
  cache: false, // disable, set to false
  ext: 'html',
  varControls: ["[[","]]"],
  writeBody: false,
}));

errorHandler.error(app, logger);


initController(app);

app.on('error', (error) => {
  logger.error(error);
});
app.listen(config.port, () => {
  console.log('🍺，🍶', config.port);
});
