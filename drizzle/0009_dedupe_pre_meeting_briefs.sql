-- Before meeting_briefs_pre_unique_idx: keep the earliest PRE_MEETING_BRIEF per (version, builder version) and re-point references to it.
CREATE TEMP TABLE `pre_brief_dupes` AS
  SELECT b.`id` AS `dup_id`,
    (SELECT k.`id` FROM `meeting_briefs` k WHERE k.`kind` = 'PRE_MEETING_BRIEF' AND k.`version_id` = b.`version_id` AND k.`builder_version` = b.`builder_version` ORDER BY k.`created_at`, k.`id` LIMIT 1) AS `keep_id`
  FROM `meeting_briefs` b WHERE b.`kind` = 'PRE_MEETING_BRIEF';
--> statement-breakpoint
DELETE FROM `pre_brief_dupes` WHERE `dup_id` = `keep_id`;
--> statement-breakpoint
UPDATE `founder_meetings` SET `pre_brief_id` = (SELECT `keep_id` FROM `pre_brief_dupes` WHERE `dup_id` = `founder_meetings`.`pre_brief_id`) WHERE `pre_brief_id` IN (SELECT `dup_id` FROM `pre_brief_dupes`);
--> statement-breakpoint
UPDATE `meeting_briefs` SET `content` = json_set(`content`, '$.preBriefId', (SELECT `keep_id` FROM `pre_brief_dupes` WHERE `dup_id` = json_extract(`meeting_briefs`.`content`, '$.preBriefId'))) WHERE `kind` = 'POST_MEETING_BRIEF' AND json_extract(`content`, '$.preBriefId') IN (SELECT `dup_id` FROM `pre_brief_dupes`);
--> statement-breakpoint
DELETE FROM `meeting_briefs` WHERE `id` IN (SELECT `dup_id` FROM `pre_brief_dupes`);
--> statement-breakpoint
DROP TABLE `pre_brief_dupes`;
