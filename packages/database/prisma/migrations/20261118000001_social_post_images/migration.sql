-- CreateTable
CREATE TABLE "social_post_images" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_post_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_post_images_postId_key" ON "social_post_images"("postId");

-- AddForeignKey
ALTER TABLE "social_post_images" ADD CONSTRAINT "social_post_images_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

