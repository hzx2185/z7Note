let sharp;
const log = require('../utils/logger');
try {
  sharp = require('sharp');
} catch (e) {
  // sharp 未安装，压缩功能不可用
  log('WARN', 'sharp 模块未安装，图片压缩功能将被跳过');
}

const config = require('../config');
const { getSystemConfig } = require('./systemConfig');

/**
 * 压缩图片
 * @param {Buffer} inputBuffer - 输入图片数据
 * @param {string} mimeType - MIME类型
 * @returns {Promise<Buffer>} 压缩后的图片数据
 */
async function compressImage(inputBuffer, mimeType) {
  // 检查 sharp 是否可用
  if (!sharp) {
    return { buffer: inputBuffer, compressed: false };
  }
  // 检查是否启用图片压缩
  const enabled = await getSystemConfig('imageCompressionEnabled');
  if (enabled === 'false') {
    return { buffer: inputBuffer, compressed: false };
  }

  // 检查是否支持此格式
  const formats = config.imageCompression.formats;
  if (!formats.includes(mimeType)) {
    return { buffer: inputBuffer, compressed: false };
  }

  try {
    // 获取压缩配置
    const quality = parseInt(await getSystemConfig('imageCompressionQuality')) || config.imageCompression.quality;
    const maxWidth = parseInt(await getSystemConfig('imageCompressionMaxWidth')) || config.imageCompression.maxWidth;
    const maxHeight = parseInt(await getSystemConfig('imageCompressionMaxHeight')) || config.imageCompression.maxHeight;

    // 获取图片信息
    const metadata = await sharp(inputBuffer).metadata();
    let needsResize = metadata.width > maxWidth || metadata.height > maxHeight;

    // 构建处理链
    let pipeline = sharp(inputBuffer);

    if (needsResize) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // 根据格式进行压缩
    const format = mimeType.split('/')[1];
    let compressPipeline;

    switch (format) {
      case 'jpeg':
      case 'jpg':
        compressPipeline = pipeline.jpeg({ quality });
        break;
      case 'png':
        compressPipeline = pipeline.png({
          quality: Math.round(quality / 100 * 9), // PNG使用0-9，0最快
          compressionLevel: 9
        });
        break;
      case 'webp':
        compressPipeline = pipeline.webp({ quality });
        break;
      default:
        return { buffer: inputBuffer, compressed: false };
    }

    const outputBuffer = await compressPipeline.toBuffer();
    const compressionRatio = ((inputBuffer.length - outputBuffer.length) / inputBuffer.length * 100).toFixed(2);

    return {
      buffer: outputBuffer,
      compressed: true,
      originalSize: inputBuffer.length,
      compressedSize: outputBuffer.length,
      compressionRatio: parseFloat(compressionRatio)
    };
  } catch (error) {
    log('ERROR', '图片压缩失败', { error: error.message, stack: error.stack });
    // 压缩失败，返回原始数据
    return { buffer: inputBuffer, compressed: false };
  }
}

module.exports = {
  compressImage
};
