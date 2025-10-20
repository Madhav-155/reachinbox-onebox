const fetch = require('cross-fetch');

const ES = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';

async function checkEs() {
  try {
    const res = await fetch(`${ES}/_cluster/health` , { method: 'GET' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    console.log('elasticsearch', 'ok', json.status || json);
    return true;
  } catch (err) {
    console.error('elasticsearch', 'error', err.message || err);
    return false;
  }
}

async function checkQdrant() {
  try {
    const res = await fetch(`${QDRANT}/collections`, { method: 'GET' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    console.log('qdrant', 'ok', json);
    return true;
  } catch (err) {
    console.error('qdrant', 'error', err.message || err);
    return false;
  }
}

(async () => {
  const esOk = await checkEs();
  const qOk = await checkQdrant();
  if (esOk && qOk) {
    console.log('All services reachable');
    process.exit(0);
  }
  console.error('One or more services are unreachable');
  process.exit(1);
})();
