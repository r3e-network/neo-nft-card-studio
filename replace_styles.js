const fs = require('fs');
const glob = require('glob');

const replacements = [
  {
    regex: /className="panel-header" style={{ marginBottom: '1\.5rem', paddingBottom: '1rem' }}/g,
    replacement: 'className="panel-header mb-md pb-sm"'
  },
  {
    regex: /style={{ display: 'flex', alignItems: 'center', gap: '0\.5rem' }}/g,
    replacement: 'className="flex-align-center gap-md"'
  },
  {
    regex: /style={{ display: "flex", alignItems: "center", gap: "0\.5rem" }}/g,
    replacement: 'className="flex-align-center gap-md"'
  },
  {
    regex: /style={{ display: 'flex', alignItems: 'center', gap: '0\.4rem' }}/g,
    replacement: 'className="flex-align-center gap-sm"'
  },
  {
    regex: /style={{ display: 'flex', alignItems: 'center', gap: '0\.3rem' }}/g,
    replacement: 'className="flex-align-center gap-xs-3"'
  },
  {
    regex: /style={{ display: 'flex', alignItems: 'center', gap: '0\.2rem' }}/g,
    replacement: 'className="flex-align-center gap-xs"'
  },
  {
    regex: /style={{ display: 'inline-flex', alignItems: 'center', gap: '0\.2rem' }}/g,
    replacement: 'className="inline-flex flex-align-center gap-xs"'
  },
  {
    regex: /className="hint" style={{ marginTop: '0\.25rem' }}/g,
    replacement: 'className="hint mt-xs"'
  },
  {
    regex: /className="panel-header" style={{ marginBottom: '1rem' }}/g,
    replacement: 'className="panel-header mb-sm"'
  },
  {
    regex: /className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}/g,
    replacement: 'className="panel-header border-b-0 pb-0"'
  },
  {
    regex: /className="panel-header" style={{ borderBottom: "none", paddingBottom: 0 }}/g,
    replacement: 'className="panel-header border-b-0 pb-0"'
  },
  {
    regex: /className="panel-header" style={{ borderBottom: '1px solid rgba\(255, 255, 255, 0\.05\)', paddingBottom: '0\.75rem', marginBottom: '1rem' }}/g,
    replacement: 'className="panel-header border-b-light pb-xs mb-sm"'
  },
  {
    regex: /style={{ display: 'flex', alignItems: 'center', gap: '0\.5rem', padding: '1rem 2rem', fontSize: '1rem' }}/g,
    replacement: 'className="flex-align-center gap-md btn-lg"'
  },
  {
    regex: /style={{\n\s*marginTop: '0\.5rem',\n\s*padding: '2\.5rem',\n\s*border: '2px dashed rgba\(0, 229, 153, 0\.3\)',\n\s*borderRadius: '12px',\n\s*textAlign: 'center',\n\s*cursor: 'pointer',\n\s*background: 'rgba\(11, 14, 20, 0\.8\)',\n\s*transition: 'all 0\.3s ease'\n\s*}}/g,
    replacement: ''
  },
  {
    regex: /style={{\n\s*marginTop: '0\.5rem',\n\s*padding: '2rem',\n\s*border: '2px dashed rgba\(0, 229, 153, 0\.3\)',\n\s*borderRadius: '12px',\n\s*textAlign: 'center',\n\s*cursor: 'pointer',\n\s*background: 'rgba\(11, 14, 20, 0\.8\)',\n\s*transition: 'all 0\.3s ease'\n\s*}}/g,
    replacement: ''
  },
  {
    regex: /className="upload-area"/g,
    replacement: 'className="upload-area"'
  },
  {
    regex: /onMouseOver={\(e\) => e\.currentTarget\.style\.borderColor = 'rgba\(0, 229, 153, 0\.8\)'}\n\s*onMouseOut={\(e\) => e\.currentTarget\.style\.borderColor = 'rgba\(0, 229, 153, 0\.3\)'}/g,
    replacement: ''
  },
  {
    regex: /style={{ color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0\.5rem' }}/g,
    replacement: 'className="text-white font-semibold flex-center gap-md"'
  },
  {
    regex: /style={{ color: '#9CA3AF', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0\.5rem' }}/g,
    replacement: 'className="text-muted flex-center flex-col gap-md"'
  },
  {
    regex: /style={{ marginTop: '2rem' }}/g,
    replacement: 'className="mt-md"'
  }
];

const files = glob.sync('apps/web/src/**/*.tsx');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;
  
  replacements.forEach(({regex, replacement}) => {
    content = content.replace(regex, replacement);
  });
  
  // Custom manual replacements for className composition
  content = content.replace(/className="full form-actions" className="mt-md"/g, 'className="full form-actions mt-md"');
  content = content.replace(/className="btn" disabled={submitting} type="submit" className="flex-align-center gap-md btn-lg"/g, 'className="btn flex-align-center gap-md btn-lg" disabled={submitting} type="submit"');
  content = content.replace(/className="upload-area"\n\s*onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}\n\s*\n\s*/g, 'className="upload-area"\n            onClick={() => fileInputRef.current?.click()}\n');

  if (content !== originalContent) {
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
  }
});
