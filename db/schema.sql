-- 校园轻集市 MySQL 8 建表脚本
-- 对应 campus-light-market-prd copy.md v3.0 的核心数据模型。

CREATE DATABASE IF NOT EXISTS campus_light_market_03
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE campus_light_market_03;

CREATE TABLE IF NOT EXISTS app_state (
  id TINYINT PRIMARY KEY,
  data JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  avatar_url VARCHAR(255),
  phone VARCHAR(30),
  email VARCHAR(100),
  school_id BIGINT,
  campus_id BIGINT,
  verify_status TINYINT NOT NULL DEFAULT 0 COMMENT '0 未认证，1 待审核，2 已认证，3 驳回',
  credit_score INT NOT NULL DEFAULT 60,
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0 正常，1 封禁，2 注销',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_verify_status (verify_status),
  INDEX idx_user_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'admin',
  status TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campus_verification (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  student_no VARCHAR(50) NOT NULL,
  method VARCHAR(30) NOT NULL,
  proof_url VARCHAR(255),
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0 待审核，1 通过，2 驳回',
  reject_reason VARCHAR(255),
  reviewed_by BIGINT,
  reviewed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_verification_user (user_id),
  INDEX idx_verification_status (status),
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS category (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parent_id BIGINT DEFAULT 0,
  channel VARCHAR(30) NOT NULL,
  name VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_category_channel (channel, status, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS listing (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  publisher_id BIGINT NOT NULL,
  channel VARCHAR(30) NOT NULL COMMENT 'idle, wanted, service, lost',
  category_id BIGINT,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10,2),
  budget_min DECIMAL(10,2),
  budget_max DECIMAL(10,2),
  condition_level VARCHAR(30),
  campus_id BIGINT,
  location_text VARCHAR(120),
  trade_method VARCHAR(30),
  contact_mode VARCHAR(30) NOT NULL DEFAULT 'site_message',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0 待审核，1 展示中，2 已完成，3 已下架',
  view_count INT NOT NULL DEFAULT 0,
  favorite_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FULLTEXT INDEX ft_listing_title_desc (title, description),
  INDEX idx_listing_channel_status_campus_created (channel, status, campus_id, created_at),
  INDEX idx_listing_publisher (publisher_id),
  INDEX idx_listing_category (category_id),
  CONSTRAINT fk_listing_publisher FOREIGN KEY (publisher_id) REFERENCES user (id),
  CONSTRAINT fk_listing_category FOREIGN KEY (category_id) REFERENCES category (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS listing_image (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id BIGINT NOT NULL,
  image_url LONGTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_listing_image_listing (listing_id, sort_order),
  CONSTRAINT fk_listing_image_listing FOREIGN KEY (listing_id) REFERENCES listing (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_order (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  publisher_id BIGINT NOT NULL,
  taker_id BIGINT,
  task_type VARCHAR(30) NOT NULL COMMENT 'pickup, delivery, print, buy, other',
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  pickup_location VARCHAR(120) NOT NULL,
  delivery_location VARCHAR(120) NOT NULL,
  campus_id BIGINT,
  reward DECIMAL(10,2) NOT NULL DEFAULT 0,
  deadline_at DATETIME NOT NULL,
  item_note VARCHAR(255),
  proof_required TINYINT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1 待接单，2 进行中，3 已完成，4 已取消',
  cancel_reason VARCHAR(255),
  completed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_status_campus_deadline (status, campus_id, deadline_at),
  INDEX idx_task_publisher_taker (publisher_id, taker_id),
  CONSTRAINT fk_task_publisher FOREIGN KEY (publisher_id) REFERENCES user (id),
  CONSTRAINT fk_task_taker FOREIGN KEY (taker_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_status_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT NOT NULL,
  operator_id BIGINT NOT NULL,
  from_status TINYINT,
  to_status TINYINT NOT NULL,
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_status_log_task (task_id, created_at),
  CONSTRAINT fk_task_status_log_task FOREIGN KEY (task_id) REFERENCES task_order (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_status_log_operator FOREIGN KEY (operator_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  target_type VARCHAR(30) NOT NULL COMMENT 'listing 或 task',
  target_id BIGINT NOT NULL,
  buyer_id BIGINT NOT NULL,
  seller_id BIGINT NOT NULL,
  last_message VARCHAR(255),
  last_message_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation_buyer (buyer_id, last_message_at),
  INDEX idx_conversation_seller (seller_id, last_message_at),
  INDEX idx_conversation_target (target_type, target_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  read_status TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_message_conversation_created (conversation_id, created_at),
  CONSTRAINT fk_message_conversation FOREIGN KEY (conversation_id) REFERENCES conversation (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS favorite (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  target_type VARCHAR(30) NOT NULL COMMENT 'listing 或 task',
  target_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_favorite_target (user_id, target_type, target_id),
  INDEX idx_favorite_user (user_id, created_at),
  CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS browse_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_browse_history_user (user_id, created_at),
  CONSTRAINT fk_browse_history_user FOREIGN KEY (user_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  reporter_id BIGINT NOT NULL,
  target_type VARCHAR(30) NOT NULL COMMENT 'user, listing, task, message',
  target_id BIGINT NOT NULL,
  reason VARCHAR(100) NOT NULL,
  description TEXT,
  evidence_url VARCHAR(255),
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0 待处理，1 已处理，2 驳回',
  handled_by BIGINT,
  handled_at DATETIME,
  handle_result VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_report_status_target (status, target_type, target_id),
  INDEX idx_report_reporter (reporter_id),
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS review (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  reviewer_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL,
  target_type VARCHAR(30) NOT NULL COMMENT 'listing 或 task',
  target_id BIGINT NOT NULL,
  rating TINYINT NOT NULL,
  content VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_review_target (target_type, target_id),
  INDEX idx_review_target_user (target_user_id, created_at),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES user (id),
  CONSTRAINT fk_review_target_user FOREIGN KEY (target_user_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(100) NOT NULL,
  content VARCHAR(255) NOT NULL,
  read_status TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_user_read_created (user_id, read_status, created_at),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES user (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcement (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  level VARCHAR(30) NOT NULL DEFAULT '公告',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0 正常，1 下线',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_announcement_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_id BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id BIGINT,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_admin_created (admin_id, created_at),
  INDEX idx_audit_target (target_type, target_id),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES admin_user (id)
) ENGINE=InnoDB;
