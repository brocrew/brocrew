CREATE TABLE `work_legacy_stall_cut` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `provider_session`(`id`) ON DELETE CASCADE,
  `generation` integer NOT NULL,
  `through_ordinal` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `work_legacy_stall_cut` (`session_id`, `generation`, `through_ordinal`)
SELECT ps.id, coalesce(g.active, 0),
       coalesce((SELECT max(e.ordinal) FROM events e
                  WHERE e.session_id = ps.id AND e.generation = coalesce(g.active, 0)), -1)
  FROM provider_session ps LEFT JOIN derived_generation g ON g.session_id = ps.id;
