// Export analysis + explanation as Markdown (PRD §4.3, PLAN §7) — paste into tickets/postmortems.
const SEV_LABEL = { critical: '🔴 Critical', warning: '🟡 Warning', info: '⚪ Info' };

export function toMarkdown(sql, result, meta = {}) {
  const lines = [];
  lines.push('# Analisa Query — QueryFlow');
  lines.push('');
  if (meta.dialect) lines.push(`**Dialek:** ${meta.dialect}  `);
  lines.push(`**Tanggal:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## Query');
  lines.push(meta.engine === 'mongo' ? '```js' : '```sql');
  lines.push(sql.trim());
  lines.push('```');
  lines.push('');

  // Execution flow
  lines.push('## Urutan eksekusi logis');
  for (const block of result.flow.blocks) {
    if (block.kind !== 'main') lines.push(`\n_${block.label}${block.correlated ? ' · correlated' : ''}_`);
    const steps = block.nodes.map((n, i) => `${i + 1}. **${n.title}**${n.subtitle ? ' — ' + n.subtitle : ''}`);
    lines.push(steps.join('\n'));
  }
  lines.push('');

  // Findings
  const fs = result.analysis.findings;
  lines.push(`## Temuan analisa (${fs.length})`);
  if (!fs.length) {
    lines.push('_Tidak ada temuan dari rule statis._');
  } else {
    for (const f of fs) {
      lines.push('');
      lines.push(`### ${SEV_LABEL[f.severity] || f.severity} · ${f.title}`);
      lines.push(f.why);
      if (f.before || f.after) {
        lines.push('');
        lines.push('```sql');
        if (f.before) lines.push(`-- sebelum\n${f.before}`);
        if (f.after) lines.push(`-- sesudah\n${f.after}`);
        lines.push('```');
      }
    }
  }
  lines.push('');

  // Glossary
  const entries = result.glossary.entries.filter((e) => e.hasDefinition);
  if (entries.length) {
    lines.push('## Glosarium fungsi & klausa');
    for (const e of entries) {
      lines.push(`- **${e.label}** — ${e.text}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('_Analisa statis berbasis pola umum (QueryFlow) — bukan pengganti EXPLAIN/profiling pada database aktual._');
  return lines.join('\n');
}
