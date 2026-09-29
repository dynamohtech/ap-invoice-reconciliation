// Centralized error handler — every route's catch(next(err)) ends up here.
// Keeps two things from happening: leaking stack traces/SQL text to the
// client, and every route file reinventing its own try/catch error shape.
export function errorHandler(err, req, res, next) {
  console.error(`[error] ${req.method} ${req.path}:`, err);

  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
  if (err.code === '23503') return res.status(400).json({ error: 'That reference does not exist.' });
  if (err.status) return res.status(err.status).json({ error: err.message });

  res.status(500).json({ error: 'Something went wrong on the server. Check the server logs.' });
}
