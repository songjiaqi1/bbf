import _ from './list.js';

$('.btn').on('click', _.throttle(click));

function click(event) {
  console.log(event);
}