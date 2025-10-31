export interface StructuredContentItem {
    insert:
        | string
        | {
              image?: string;
              vod?: {
                  id: string;
                  duration: number;
                  cover: string;
                  resolutions: Array<{
                      url: string;
                      definition: string;
                      height: number;
                      width: number;
                      bitrate: number;
                      size: number;
                      format: string;
                      label: string;
                      codec: string;
                  }>;
                  view_num: number;
                  transcoding_status: number;
                  review_status: number;
              };
          };
    attributes?: {
        bold?: boolean;
        color?: string;
    };
}

export function parseStructuredContentWithSplits(
    structuredContentStr: string
): { items: Array<{ type: string; data: any }>; splitPoints: number[] } {
    try {
        const contentArray: StructuredContentItem[] =
            JSON.parse(structuredContentStr);
        const cqCodeItems: Array<{ type: string; data: any }> = [];
        const splitPoints: number[] = [];
        let currentText = '';

        // 去除段落前后换行的辅助函数（只去除开头和结尾，保留中间的换行）
        const trimNewlines = (text: string): string => {
            // 只匹配字符串开头和结尾的换行符
            return text.replace(/^[\n\r]+/, '').replace(/[\n\r]+$/, '');
        };

        // 处理每个内容项
        for (const item of contentArray) {
            // 处理文本插入
            if (typeof item.insert === 'string') {
                // 检查是否包含段落符号 ▌
                const textParts = item.insert.split('▌');

                for (let i = 0; i < textParts.length; i++) {
                    // 直接使用原始部分，暂时不去除换行符
                    const part = textParts[i];

                    // 第一个部分直接添加到当前文本
                    if (i === 0) {
                        currentText += part;
                    } else {
                        // 如果不是第一个部分，说明前面有▌符号
                        // 先添加之前累积的文本（去除前后换行，保留中间换行）
                        const trimmedCurrentText = trimNewlines(currentText);
                        if (trimmedCurrentText) {
                            cqCodeItems.push({
                                type: 'text',
                                data: { text: trimmedCurrentText },
                            });
                            currentText = '';
                        }
                        // 标记分割点位置（下一个添加的CQCode就是▌）
                        splitPoints.push(cqCodeItems.length);
                        // 添加段落符号
                        cqCodeItems.push({
                            type: 'text',
                            data: { text: '▌' },
                        });
                        // 添加当前部分文本
                        currentText += part;
                    }
                }
            }
            // 处理图片插入
            else if (item.insert.image) {
                const imageUrl = item.insert.image.replace(/\s/g, '');

                // 如果当前有积累的文本，先添加（去除前后换行，保留中间换行）
                if (currentText) {
                    const trimmedCurrentText = trimNewlines(currentText);
                    if (trimmedCurrentText) {
                        cqCodeItems.push({
                            type: 'text',
                            data: { text: trimmedCurrentText },
                        });
                    }
                    currentText = '';
                }

                // 添加图片CQCode
                cqCodeItems.push({
                    type: 'image',
                    data: { file: imageUrl },
                });
            }
            // 处理视频插入
            else if (item.insert.vod) {
                const vod = item.insert.vod;
                const highestRes = vod.resolutions.reduce((prev, current) =>
                    prev.width > current.width ? prev : current
                );

                // 如果当前有积累的文本，先添加（去除前后换行，保留中间换行）
                if (currentText) {
                    const trimmedCurrentText = trimNewlines(currentText);
                    if (trimmedCurrentText) {
                        cqCodeItems.push({
                            type: 'text',
                            data: { text: trimmedCurrentText },
                        });
                    }
                    currentText = '';
                }

                const videoUrl = highestRes.url.replace(/\s/g, '');
                const videoDurationSeconds = vod.duration / 1000;

                // 视频信息文本作为单独的 CQCode 项
                cqCodeItems.push({
                    type: 'text',
                    data: {
                        text: `🎬 视频：${highestRes.definition} ${videoDurationSeconds.toFixed(1)}秒 播放:${vod.view_num}`,
                    },
                });

                // 标记视频信息作为分割点
                splitPoints.push(cqCodeItems.length);

                // 如果视频超过1分钟，则直接显示链接而不是使用video类型的CQCode
                if (videoDurationSeconds > 60) {
                    cqCodeItems.push({
                        type: 'text',
                        data: { text: `🔗 视频链接：${videoUrl}` },
                    });
                } else {
                    // 短视频使用video CQCode
                    cqCodeItems.push({
                        type: 'video',
                        data: { file: videoUrl },
                    });
                }

                // 视频后也添加分割点，确保后续内容单独出现
                splitPoints.push(cqCodeItems.length);
            }
        }

        // 处理剩余的文本（去除前后换行，保留中间换行）
        if (currentText) {
            const trimmedCurrentText = trimNewlines(currentText);
            if (trimmedCurrentText) {
                cqCodeItems.push({
                    type: 'text',
                    data: { text: trimmedCurrentText },
                });
            }
        }

        return { items: cqCodeItems, splitPoints };
    } catch (error) {
        console.error('解析结构化内容失败：', error);
        return {
            items: [
                {
                    type: 'text',
                    data: { text: '（文章内容解析失败）' },
                },
            ],
            splitPoints: [],
        };
    }
}
