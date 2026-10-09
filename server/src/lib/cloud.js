import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

if (config.cloudinaryEnabled) cloudinary.config({ ...config.cloudinary, secure: true });

export function uploadImage(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'pos-products',
        resource_type: 'image',
        transformation: [{ width: 600, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

export const deleteImage = (publicId) => cloudinary.uploader.destroy(publicId);
