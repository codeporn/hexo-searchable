'use strict';

const { createSearchable } = require('./lib/core');
const searchable = createSearchable(hexo);
hexo.searchable = searchable;

hexo.extend.generator.register('searchable', function(locals) {
  return searchable.generate(locals);
});