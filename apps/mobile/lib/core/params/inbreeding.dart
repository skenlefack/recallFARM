// Pure Dart — no Flutter imports.
// Wright's path coefficient (dossier 04 §5, MVP-SCOPE §4 « Généalogie »).

class PedigreeNode {
  const PedigreeNode({required this.id, this.sireId, this.damId, this.label});
  final String id;
  final String? sireId;
  final String? damId;
  final String? label;
}

class MatingCheckResult {
  const MatingCheckResult({
    required this.expectedCoef,
    required this.verdict,
    required this.commonAncestors,
    required this.threshold,
    required this.complete,
  });

  final double expectedCoef;

  /// `ok` | `attention` | `a_eviter`
  final String verdict;
  final List<String> commonAncestors;
  final double threshold;

  /// False when some ancestor within the depth is unknown (coefficient is a lower bound).
  final bool complete;

  factory MatingCheckResult.fromJson(Map<String, dynamic> j) => MatingCheckResult(
        expectedCoef: (j['expected_coef'] as num?)?.toDouble() ?? 0,
        verdict: (j['verdict'] ?? 'ok').toString(),
        commonAncestors: [
          for (final a in (j['common_ancestors'] as List? ?? const []))
            a is Map ? (a['id'] ?? a['name'] ?? '').toString() : a.toString()
        ],
        threshold: (j['threshold'] as num?)?.toDouble() ?? 0.0625,
        complete: j['complete'] != false,
      );
}

class Inbreeding {
  Inbreeding(this.pedigree, {this.maxGenerations = 5});

  final Map<String, PedigreeNode> pedigree;
  final int maxGenerations;
  final Map<String, double> _fMemo = {};

  static const double defaultThreshold = 0.0625;

  /// All ancestor paths from [start] (inclusive, length 0) up to [maxGenerations].
  /// Each path is the list of ids from [start] to the ancestor.
  List<List<String>> _paths(String start, int depth) {
    final out = <List<String>>[];
    void walk(String id, List<String> path, int d) {
      if (path.contains(id)) return; // loop guard (RG-MDD-05)
      final p = [...path, id];
      out.add(p);
      if (d >= depth) return;
      final node = pedigree[id];
      if (node == null) return;
      if (node.sireId != null) walk(node.sireId!, p, d + 1);
      if (node.damId != null) walk(node.damId!, p, d + 1);
    }

    walk(start, const [], 0);
    return out;
  }

  /// Inbreeding coefficient of an existing individual [id].
  double inbreedingOf(String id, [int depth = 0]) {
    final memo = _fMemo[id];
    if (memo != null) return memo;
    final node = pedigree[id];
    if (node == null || node.sireId == null || node.damId == null || depth > maxGenerations) {
      return 0;
    }
    final f = _coancestry(node.sireId!, node.damId!, maxGenerations - depth - 1, depth + 1);
    _fMemo[id] = f;
    return f;
  }

  double _coancestry(String sire, String dam, int depth, int level) {
    if (depth < 0) return 0;
    final sirePaths = _paths(sire, depth);
    final damPaths = _paths(dam, depth);
    var f = 0.0;
    for (final ps in sirePaths) {
      final ancestor = ps.last;
      for (final pd in damPaths) {
        if (pd.last != ancestor) continue;
        // Paths must only share the common ancestor.
        final setS = ps.sublist(0, ps.length - 1).toSet();
        final shared = pd.sublist(0, pd.length - 1).any(setS.contains);
        if (shared) continue;
        final n1 = ps.length - 1;
        final n2 = pd.length - 1;
        final fa = level > maxGenerations ? 0.0 : inbreedingOf(ancestor, level);
        f += _pow(0.5, n1 + n2 + 1) * (1 + fa);
      }
    }
    return f;
  }

  /// Expected inbreeding of the offspring of [sireId] × [damId].
  MatingCheckResult check(String sireId, String damId,
      {int? generations, double threshold = defaultThreshold}) {
    final depth = generations ?? maxGenerations;
    final coef = _coancestry(sireId, damId, depth, 1);
    final sireAnc = {for (final p in _paths(sireId, depth)) p.last};
    final damAnc = {for (final p in _paths(damId, depth)) p.last};
    final common = sireAnc.intersection(damAnc).toList()..sort();
    final complete = _isComplete(sireId, depth) && _isComplete(damId, depth);
    final verdict = coef >= threshold ? 'a_eviter' : (coef > 0 ? 'attention' : 'ok');
    return MatingCheckResult(
      expectedCoef: coef,
      verdict: verdict,
      commonAncestors: common,
      threshold: threshold,
      complete: complete,
    );
  }

  bool _isComplete(String id, int depth) {
    if (depth <= 0) return true;
    final node = pedigree[id];
    if (node == null || node.sireId == null || node.damId == null) return false;
    return _isComplete(node.sireId!, depth - 1) && _isComplete(node.damId!, depth - 1);
  }

  static double _pow(double b, int e) {
    var r = 1.0;
    for (var i = 0; i < e; i++) {
      r *= b;
    }
    return r;
  }
}
