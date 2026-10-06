-- Historical repair fixture. Never included in production D1 migrations.
DELETE FROM installations
WHERE source = 'salesforce'
  AND merchant_id IN (SELECT id FROM merchants WHERE salesforce_id = '001TJ0000160t7KYAQ' AND dealer_id = 1)
  AND salesforce_case_id = '500TJ000011NLQtYAO'
  AND salesforce_line_item_id IN (
    'a0yTJ00000OLxQgYAL', 'a0yTJ00000OLxQhYAL', 'a0yTJ00000OLxQiYAL',
    'a0yTJ00000OM36PYAT', 'a0yTJ00000OM36RYAT'
  );
