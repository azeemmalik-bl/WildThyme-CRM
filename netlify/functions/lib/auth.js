// Returns the authenticated Netlify Identity user for this invocation, or null.
// Netlify Functions populate context.clientContext.user automatically when the
// caller sends a valid Identity JWT in the Authorization header.
function requireUser(context) {
  return (context && context.clientContext && context.clientContext.user) || null;
}

module.exports = { requireUser };
