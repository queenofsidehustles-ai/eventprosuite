const { requireStudent } = require('./_course-auth');
const PLAYBOOKS = require('./_playbooks');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const key = String((req.query && (req.query.playbook || req.query.name)) || '');
  if (!Object.prototype.hasOwnProperty.call(PLAYBOOKS, key)) return res.status(404).json({ error: 'Playbook not found' });
  const check = await requireStudent(req);
  if (check.error) return res.status(check.status).json({ error: check.error });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="KPPS_' + key + '_Playbook.pdf"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(Buffer.from(PLAYBOOKS[key], 'base64'));
};
