import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Env() {
  return {
    region: process.env.AWS_REGION || "ap-south-1",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
  };
}

export const isS3Configured = () => {
  const env = getS3Env();
  return Boolean(env.bucket && env.region && env.accessKeyId && env.secretAccessKey);
};

export const getS3ConfigStatus = () => {
  const env = getS3Env();
  return {
    configured: isS3Configured(),
    region: env.region,
    bucket: env.bucket,
    hasAccessKeyId: Boolean(env.accessKeyId),
    hasSecretAccessKey: Boolean(env.secretAccessKey)
  };
};

let client: S3Client | null = null;

function getClient() {
  const env = getS3Env();

  if (!isS3Configured()) {
    throw new Error("S3 is not fully configured. Add AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.");
  }

  if (!client) {
    client = new S3Client({
      region: env.region,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey
      }
    });
  }

  return client;
}

export async function uploadBufferToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  const env = getS3Env();
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: env.bucket,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType
  }));

  return {
    bucket: env.bucket,
    key: params.key,
    s3Uri: `s3://${env.bucket}/${params.key}`
  };
}

export function guessPublicS3Url(key: string) {
  const env = getS3Env();
  if (!env.bucket) return "";
  return `https://${env.bucket}.s3.${env.region}.amazonaws.com/${key}`;
}

export async function createSignedS3Url(key: string, expiresInSeconds: number = 3600) {
  const env = getS3Env();
  const s3 = getClient();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.bucket,
      Key: key
    }),
    { expiresIn: expiresInSeconds }
  );
}
