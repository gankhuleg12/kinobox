-- AlterTable
ALTER TABLE `Movie` ADD COLUMN `freeEpisodes` SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN `kind` ENUM('MOVIE', 'SERIES') NOT NULL DEFAULT 'MOVIE';

-- AlterTable
ALTER TABLE `WatchProgress` ADD COLUMN `episodeId` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `Episode` (
    `id` VARCHAR(191) NOT NULL,
    `movieId` VARCHAR(191) NOT NULL,
    `seasonNumber` SMALLINT NOT NULL DEFAULT 1,
    `episodeNumber` SMALLINT NOT NULL,
    `title` VARCHAR(200) NULL,
    `titleEn` VARCHAR(200) NULL,
    `description` TEXT NULL,
    `durationSec` INTEGER NULL,
    `stillKey` VARCHAR(300) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `videoStatus` ENUM('NONE', 'UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'NONE',
    `videoProgress` INTEGER NOT NULL DEFAULT 0,
    `videoError` VARCHAR(500) NULL,
    `sourceKey` VARCHAR(300) NULL,
    `hlsPath` VARCHAR(300) NULL,
    `hlsKeyEnc` VARCHAR(255) NULL,
    `renditions` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Episode_movieId_isPublished_idx`(`movieId`, `isPublished`),
    UNIQUE INDEX `Episode_movieId_seasonNumber_episodeNumber_key`(`movieId`, `seasonNumber`, `episodeNumber`),
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reel` (
    `id` VARCHAR(191) NOT NULL,
    `movieId` VARCHAR(191) NULL,
    `caption` VARCHAR(300) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `videoStatus` ENUM('NONE', 'UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'NONE',
    `videoProgress` INTEGER NOT NULL DEFAULT 0,
    `videoError` VARCHAR(500) NULL,
    `sourceKey` VARCHAR(300) NULL,
    `videoKey` VARCHAR(300) NULL,
    `posterKey` VARCHAR(300) NULL,
    `durationSec` INTEGER NULL,
    `width` SMALLINT NULL,
    `height` SMALLINT NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reel_status_videoStatus_sortOrder_publishedAt_idx`(`status`, `videoStatus`, `sortOrder`, `publishedAt`),
    INDEX `Reel_movieId_idx`(`movieId`),
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Movie_kind_status_idx` ON `Movie`(`kind`, `status`);

-- AddForeignKey
ALTER TABLE `Episode` ADD CONSTRAINT `Episode_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `Movie`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reel` ADD CONSTRAINT `Reel_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `Movie`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

