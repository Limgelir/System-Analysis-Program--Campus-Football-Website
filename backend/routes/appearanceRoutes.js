const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { getAppearance } = require('../services/appearanceRollout');

// Only the authenticated account's decision is returned, never the allowlist.
router.get('/', authenticate, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.vary('Authorization');
  res.json({ success: true, data: getAppearance(req.authenticatedActor) });
});
module.exports = router;
