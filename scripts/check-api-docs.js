// Fails (exit 1) when a route exists without docs, or docs describe a route that's gone.
// Run: npm run docs:check
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const spec = require(path.join(SRC, 'docs', 'openapi'));

// "/api/shifts" ← shiftRoutes ← './routes/shift.routes'
const appSource = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const routeFiles = Object.fromEntries([...appSource.matchAll(/const (\w+) = require\('\.\/routes\/([\w.]+)'\)/g)].map(([, name, file]) => [name, file]));
const mounts = [...appSource.matchAll(/app\.use\('\/api(\/[\w-]+)', (\w+)\)/g)].map(([, prefix, name]) => ({ prefix, file: routeFiles[name] }));

const implemented = mounts.flatMap(({ prefix, file }) => {
    const source = fs.readFileSync(path.join(SRC, 'routes', `${file}.js`), 'utf8');
    // router.get('/x', …) and router.post(\n '/x', …)
    return [...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)].map(([, method, route]) => {
        const full = `${prefix}${route === '/' ? '' : route}`.replace(/:(\w+)/g, '{$1}');
        return `${method.toUpperCase()} ${full}`;
    });
});

const documented = Object.entries(spec.paths).flatMap(([route, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`));

const missing = implemented.filter((r) => !documented.includes(r));
const stale = documented.filter((r) => !implemented.includes(r));
const undescribed = Object.entries(spec.paths).flatMap(([route, methods]) =>
    Object.entries(methods).filter(([, operation]) => !operation.summary || !operation.description).map(([method]) => `${method.toUpperCase()} ${route}`)
);

if (missing.length) console.error('Routes without docs:\n  ' + missing.join('\n  '));
if (stale.length) console.error('Docs for routes that no longer exist:\n  ' + stale.join('\n  '));
if (undescribed.length) console.error('Docs missing a summary or description:\n  ' + undescribed.join('\n  '));
if (missing.length || stale.length || undescribed.length) process.exit(1);
console.log(`API docs OK — ${implemented.length} routes documented.`);
