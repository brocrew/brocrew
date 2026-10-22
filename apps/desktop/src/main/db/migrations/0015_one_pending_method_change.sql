CREATE UNIQUE INDEX `identity_method_change_pending_uq` ON `identity_method_change` (`identity_id`) WHERE `outcome` = 'pending';
