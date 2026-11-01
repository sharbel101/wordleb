-- Starter word list for WordleB. Review before running: spelling and meanings are
-- my best effort at common Lebanese words, so correct anything you disagree with.
-- Run in the Supabase SQL editor. Safe to re-run: words already in the table are skipped.
-- Assumes columns: word, meaning, arabic_spelling, example_sentence, translation, approved.

insert into words (word, meaning, arabic_spelling, example_sentence, translation, approved)
select v.word, v.meaning, v.arabic, v.example, v.translation, true
from (values
  ('yalla', 'Let''s go / come on / hurry up',  'يلا',    'Yalla, ta2akhrna.',        'Come on, we are late.'),
  ('ba7ar', 'Sea',                             'بحر',    null,                       null),
  ('kteer', 'A lot / very',                    'كتير',   'Hayda kteer helo.',        'This is very nice.'),
  ('sa7en', 'Plate / dish',                    'صحن',    null,                       null),
  ('7elou', 'Sweet / nice / good-looking',     'حلو',    null,                       null),
  ('5obez', 'Bread',                           'خبز',    null,                       null),
  ('zghir', 'Small',                           'زغير',   null,                       null),
  ('shams', 'Sun',                             'شمس',    null,                       null),
  ('ba3ed', 'Still / yet / after',             'بعد',    null,                       null),
  ('2ahwe', 'Coffee',                          'قهوة',   null,                       null),
  ('3ayni', 'My eye (a term of endearment)',   'عيني',   null,                       null),
  ('7abib', 'Dear / darling',                  'حبيب',   null,                       null),
  ('ta3al', 'Come (here)',                     'تعال',   null,                       null),
  ('leish', 'Why',                             'ليش',    null,                       null),
  ('hayda', 'This (masculine)',                'هيدا',   null,                       null),
  ('hayde', 'This (feminine)',                 'هيدي',   null,                       null),
  ('lissa', 'Still / not yet',                 'لسا',    null,                       null),
  ('ya3ni', 'I mean / meaning / so',           'يعني',   null,                       null),
  ('walla', 'I swear / really',                'والله',  null,                       null),
  ('tayyb', 'Okay / fine / good',              'طيب',    null,                       null),
  ('kifak', 'How are you? (to a man)',         'كيفك',   null,                       null),
  ('shabb', 'Young man / guy',                 'شب',     null,                       null),
  ('2amar', 'Moon',                            'قمر',    null,                       null),
  ('najme', 'Star',                            'نجمة',   null,                       null),
  ('talej', 'Snow / ice',                      'تلج',    null,                       null),
  ('marra', 'Once / a time / very',            'مرة',    null,                       null),
  ('sa7bi', 'My friend',                       'صاحبي',  null,                       null)
) as v(word, meaning, arabic, example, translation)
where not exists (select 1 from words w where lower(w.word) = v.word);

-- Check: should list the rows above, all approved.
select word, meaning, arabic_spelling, approved from words order by word;
