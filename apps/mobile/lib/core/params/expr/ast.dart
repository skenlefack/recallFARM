// Pure Dart — no Flutter imports.

sealed class Node {
  const Node();
}

class LiteralNode extends Node {
  const LiteralNode(this.value);
  final Object? value;
}

class IdentNode extends Node {
  const IdentNode(this.name);
  final String name;
}

class ListNode extends Node {
  const ListNode(this.items);
  final List<Node> items;
}

class MemberNode extends Node {
  const MemberNode(this.target, this.name);
  final Node target;
  final String name;
}

class IndexNode extends Node {
  const IndexNode(this.target, this.index);
  final Node target;
  final Node index;
}

class CallNode extends Node {
  const CallNode(this.name, this.args);
  final String name;
  final List<Node> args;
}

class UnaryNode extends Node {
  const UnaryNode(this.op, this.operand);
  final String op;
  final Node operand;
}

class BinaryNode extends Node {
  const BinaryNode(this.op, this.left, this.right);
  final String op;
  final Node left;
  final Node right;
}

class TernaryNode extends Node {
  const TernaryNode(this.cond, this.then, this.otherwise);
  final Node cond;
  final Node then;
  final Node otherwise;
}
