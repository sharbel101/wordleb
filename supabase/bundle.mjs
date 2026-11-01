// Builds self-contained single-file versions of each function for pasting into
// the Supabase dashboard editor: node supabase/bundle.mjs
import fs from 'node:fs'
const fns = {
  'get-daily-puzzle': ['beirut', 'http', 'validate'],
  'submit-guess': ['beirut', 'evaluate', 'validate', 'token', 'turn', 'http'],
  'submit-suggestion': ['http', 'validate'],
  'get-community-stats': ['beirut', 'community', 'http'],
}
const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')
for (const [name, shared] of Object.entries(fns)) {
  const parts = ["import { createClient } from 'npm:@supabase/supabase-js@2'\n"]
  for (const s of shared) {
    parts.push(`// ---- _shared/${s}.ts ----`, strip(fs.readFileSync(`supabase/functions/_shared/${s}.ts`, 'utf8')))
  }
  parts.push(`// ---- ${name} ----`, strip(fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')))
  fs.writeFileSync(`supabase/dashboard/${name}.ts`, parts.join('\n') + '\n')
}
