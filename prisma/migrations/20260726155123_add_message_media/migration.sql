-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT;

alter table "messages" add constraint "messages_has_content_or_media"
  check (content is not null or "mediaUrl" is not null);