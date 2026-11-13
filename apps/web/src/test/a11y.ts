import axe from 'axe-core';

/**
 * Lance axe-core sur le document courant (ADR-005) et echoue sur toute violation serieuse ou critique.
 * jsdom ne calcule pas les couleurs rendues : `color-contrast` est desactivee ici (voir l'ADR).
 */
export async function expectNoSeriousViolations(context: Element = document.body): Promise<void> {
  const res = await axe.run(context, { rules: { 'color-contrast': { enabled: false } } });
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.id} (${v.impact}) : ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n');
  if (bad.length > 0) throw new Error(`Violations d'accessibilite :\n${report}`);
}
