import cloudinary from '../config/cloudinary';

export async function uploadToCloudinary(
  file: Express.Multer.File
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'vhi-shipments', resource_type: 'auto' },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error('Cloudinary upload returned no result'));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(file.buffer);
  });
}
