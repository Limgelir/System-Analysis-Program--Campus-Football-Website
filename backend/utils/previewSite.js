const express = require('express');
const path = require('node:path');

// The API root returns JSON. Only API paths may reach it in a combined preview.
module.exports = function previewSite(api, directory) {
  const site = express();
  site.use((req, res, next) => req.path === '/api' || req.path.startsWith('/api/') ? api(req, res, next) : next());
  site.use(express.static(directory));
  site.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(directory, 'index.html')));
  return site;
};
