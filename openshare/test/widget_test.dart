import 'package:flutter_test/flutter_test.dart';

import 'package:openshare/main.dart';

void main() {
  testWidgets('App renders home screen', (WidgetTester tester) async {
    await tester.pumpWidget(const OpenShareApp());

    // Check home screen renders with key elements
    expect(find.text('OpenShare'), findsOneWidget);
    expect(find.text('Start Sharing'), findsOneWidget);
    expect(find.text('Browse Networks'), findsOneWidget);
  });
}
