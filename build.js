// Produces kites-and-threads-workflow.standalone.html: one file that works fully offline.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const logic = fs.readFileSync(path.join(dir, 'workflow.js'), 'utf8');
const tag = '<script src="workflow.js"></script>';
if (!html.includes(tag)) throw new Error('Expected ' + tag + ' in index.html');
const logoTag = 'src="logo-white.png"';
if (!html.includes(logoTag)) throw new Error('Expected ' + logoTag + ' in index.html');
const logoUri = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'logo-white.png')).toString('base64');
const out = html.replace(tag, () => '<script>\n' + logic + '\n</script>').replace(logoTag, () => 'src="' + logoUri + '"');
fs.writeFileSync(path.join(dir, 'kites-and-threads-workflow.standalone.html'), out);
console.log('wrote kites-and-threads-workflow.standalone.html');
