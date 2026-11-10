# Langage d'expressions RecallFarm — sous-ensemble CEL (MVP)

Référence : dossier `12` §5 (décision D-02 : CEL). Ce document est le **contrat commun** aux deux
implémentations : `apps/api/src/params/expr` (TypeScript) et `apps/mobile/lib/core/params/expr` (Dart).
Les deux doivent passer **tous** les cas de `vectors/expressions.json` (RG-PAR-02).

## Grammaire (précédence croissante)

```
expr      := ternary
ternary   := or ( '?' expr ':' expr )?
or        := and ( '||' and )*
and       := equality ( '&&' equality )*
equality  := relation ( ('==' | '!=') relation )*
relation  := additive ( ('<' | '<=' | '>' | '>=' | 'in') additive )*
additive  := mult ( ('+' | '-') mult )*
mult      := unary ( ('*' | '/' | '%') unary )*
unary     := ('!' | '-') unary | postfix
postfix   := primary ( '.' IDENT | '[' expr ']' | '(' args? ')' )*
primary   := NUMBER | STRING | 'true' | 'false' | 'null' | IDENT | '(' expr ')' | '[' args? ']'
args      := expr ( ',' expr )*
```

- Nombres : entiers ou décimaux (`12`, `0.5`). **Tous les nombres sont des flottants 64 bits** ;
  `7 / 2 == 3.5` (écart volontaire à CEL, plus intuitif pour les référents).
- Chaînes : guillemets simples ou doubles, échappements `\\`, `\'`, `\"`, `\n`.
- `in` : appartenance à une liste (`'rage' in diseases`) ou clé d'un objet.
- `+` concatène deux chaînes ; mélange chaîne/nombre → erreur.
- Accès à un champ absent → `null`. Arithmétique ou comparaison d'ordre avec `null` → erreur `null_operand`.
- `==` / `!=` : égalité profonde (nombres, chaînes, booléens, null, listes).
- `&&`, `||` : court-circuit ; opérandes non booléens → erreur `type`.
- Ternaire : la condition doit être booléenne.

## Fonctions (MVP)

| Fonction | Sens |
|---|---|
| `size(x)` | longueur d'une chaîne ou d'une liste |
| `has(x)` | `x != null` (forme fonction uniquement) |
| `coalesce(a, b, …)` | premier argument non nul |
| `if(c, a, b)` | comme le ternaire |
| `round(x)` / `round(x, n)` | arrondi « demi vers le haut en valeur absolue » à n décimales |
| `abs(x)`, `min(a, b, …)`, `max(a, b, …)` | usuels ; `min`/`max` acceptent aussi une liste unique |
| `sum(list)`, `avg(list)`, `count(list)` | agrégats sur une liste de nombres (`avg([])` → `null`) |
| `days_between(d1, d2)` | nombre de jours entiers de `d1` à `d2` (dates `YYYY-MM-DD` ou ISO) |
| `add_days(d, n)` | date `YYYY-MM-DD` décalée de n jours |
| `age_days(d)` | `days_between(d, now)` ; `now` est une variable de contexte `YYYY-MM-DD` |

## Budget
10 000 opérations par évaluation (chaque nœud évalué compte 1). Dépassement → erreur `budget`.

## Résultat
`{ "ok": true, "value": … }` ou `{ "ok": false, "error": "<code>" }` avec code parmi
`syntax`, `unknown_function`, `type`, `null_operand`, `division_by_zero`, `budget`, `arity`.
Les vecteurs ne vérifient que le **code** d'erreur.
