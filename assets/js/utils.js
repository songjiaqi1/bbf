var ArrayProto = Array.prototype;
var push = ArrayProto.push;

function _ (obj) {
  if (!(this instanceof _)) return new _(obj);
  this._wrap = obj;
}

_.each = function (obj, fuc) {
  if (Array.isArray(obj))  {
    for(var item of obj) {
      if(fuc && _.isFunction(fuc)) {
        fuc.call(_, item);
      }
    }
  }
};

_.isFunction = function (obj) {
  return typeof obj == 'function' || false;
};

_.mixin = function (obj) {
  _.each(_.functions(obj), function(name) {
    _.prototype[name] = function () {
      var func = obj[name]
      let arg = [this._wrap];
      push.apply(arg, arguments );
      func.apply(_, arg);
    }
  });
  return _;
}

_.throttle = function (fn, wait = 3000) {
  let timer;
  return function (...args) {
    if (timer == null) {
      timer = setTimeout(() => timer = null, wait);
      fn.apply(this, args);
    }
  }
}


_.functions = function (obj) {
  var names = [];
  for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
  }
  return names.sort();
};

_.mixin(_);
export default _ ;