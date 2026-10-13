ALTER TABLE gmail_actions
  MODIFY COLUMN action ENUM('markRead', 'markUnread', 'archive', 'unarchive', 'trash', 'restore', 'send') NOT NULL;
