import axios from 'axios';
import { Context } from 'koishi';
import { parseStructuredContentWithSplits } from './content-helper';
import { Config, UserSubscription } from './index';
import { createBotTextMsgNode } from './onebot-helper';
import { getRandomUserAgent } from './web-helper';

interface PostItem {
    post: {
        game_id: number;
        post_id: string;
        f_forum_id: number;
        uid: string;
        subject: string;
        content: string;
        updated_at: number;
        deleted_at: number;
        structured_content?: string; // 新增结构化内容字段
    };
    forum: {
        id: number;
        name: string;
        icon: string;
        game_id: number;
    };
    user: {
        uid: string;
        nickname: string;
        avatar_url: string;
        certification?: {
            type: number;
            label: string;
        };
    };
    cover?: {
        url: string;
        height: number;
        width: number;
    };
    image_list?: Array<{
        url: string;
        height: number;
        width: number;
    }>;
    stat: {
        view_num: number;
        reply_num: number;
        like_num: number;
    };
}

// API 响应接口
interface ApiResponse {
    retcode: number;
    message: string;
    data: {
        list: PostItem[];
        has_more: boolean;
        last_id: string;
    };
}

// 获取用户文章列表
async function fetchUserPosts(
    uid: string,
    size: number,
    timeout: number
): Promise<PostItem[]> {
    try {
        const response = await axios.get<ApiResponse>(
            `https://bbs-api.miyoushe.com/painter/wapi/userPostList`,
            {
                params: {
                    size,
                    uid,
                },
                timeout,
                headers: {
                    'User-Agent': getRandomUserAgent(),
                },
            }
        );

        if (response.data.retcode === 0) {
            return response.data.data.list;
        } else {
            // 直接记录错误，不抛出异常
            console.warn(`API 错误：${response.data.message}`);
            return [];
        }
    } catch (error) {
        console.warn(`获取 UID ${uid} 的文章失败:`, error);
        return [];
    }
}

// 格式化文章信息
function formatPostInfo(post: PostItem): string {
    const certification = post.user.certification
        ? `[${post.user.certification.label}] `
        : '';

    let result = `📢 ${certification}${post.user.nickname} 发布了新文章\n`;
    result += `🔹 标题：${post.post.subject}\n`;

    // 添加头像信息（用于后续可能的 CQ 码生成）
    result += `👤 作者：${post.user.nickname} (UID: ${post.user.uid})\n`;

    // 添加统计信息
    result += `📊 阅读：${post.stat.view_num} | 评论：${post.stat.reply_num} | 点赞：${post.stat.like_num}\n`;

    // 添加文章链接（米游社网页版链接）
    result += `🔗 链接：https://bbs.mihoyo.com/ys/article/${post.post.post_id}\n`;

    // 添加板块信息
    result += `🏷️ 板块：${post.forum.name}`;

    return result;
}

// 检查并发送新文章
export async function checkAndSendNewPosts(
    ctx: Context,
    cfg: Config
): Promise<void> {
    // 1. 处理配置文件中设置的 watchedUsers（群聊通知）
    for (const userConfig of cfg.watchedUsers) {
        const uid = userConfig.uid;
        const groupIds = userConfig.groupIds;

        if (groupIds.length === 0) continue;

        try {
            // 获取用户最新文章
            const posts = await fetchUserPosts(
                uid,
                cfg.articleSize,
                cfg.requestTimeout
            );

            if (posts.length === 0) {
                console.log(`UID ${uid} 没有找到文章`);
                continue;
            }

            // 按更新时间排序，最新的在前
            posts.sort((a, b) => b.post.updated_at - a.post.updated_at);

            // 获取已记录的文章
            const existingPosts = await ctx.database.get('hoyolab_posts', {
                uid,
            });
            const existingPostIds = new Set(
                existingPosts.map((p) => p.post_id)
            );

            // 先将所有获取到的文章存入数据库
            for (const post of posts) {
                if (!existingPostIds.has(post.post.post_id)) {
                    try {
                        await ctx.database.create('hoyolab_posts', {
                            uid,
                            post_id: post.post.post_id,
                            title: post.post.subject,
                            updated_at: post.post.updated_at,
                            sent_groups: '', // 初始为空，后续会根据实际发送情况更新
                        });
                    } catch (error) {
                        console.warn(
                            `保存文章 ${post.post.post_id} 到数据库失败:`,
                            error
                        );
                    }
                }
            }

            // 只检查最新的一篇文章是否需要发送
            const latestPost = posts[0];

            // 检查最新文章是否已发送
            const latestPostExists = await ctx.database.get('hoyolab_posts', {
                uid,
                post_id: latestPost.post.post_id,
                sent_groups: { $regex: groupIds.join('|') },
            });

            if (latestPostExists.length > 0) {
                console.log(`UID ${uid} 的最新文章已发送过，跳过`);
                continue;
            }
            console.log(
                `UID ${uid} 发现新文章（群聊通知），准备发送到 ${groupIds.length} 个群聊`
            );

            try {
                // 检查是否已被删除
                if (latestPost.post.deleted_at > 0) {
                    console.log(
                        `最新文章 ${latestPost.post.post_id} 已被删除，跳过发送`
                    );
                    continue;
                }

                // 准备合并转发消息节点
                for (const groupId of groupIds) {
                    try {
                        const bot = ctx.bots.find(
                            (b) => b.platform === 'onebot'
                        );
                        if (!bot) {
                            ctx.logger('hoyolab-notifier').warn(
                                '未找到 onebot 平台的机器人'
                            );
                            continue;
                        }

                        // 创建合并转发消息节点数组
                        const nodes: any[] = [
                            createBotTextMsgNode(
                                bot,
                                formatPostInfo(latestPost)
                            ),
                        ];

                        // 添加文章内容标题
                        nodes.push(
                            createBotTextMsgNode(bot, [
                                { type: 'text', data: { text: '📑 文章内容' } },
                            ])
                        );

                        // 解析结构化内容并添加到合并转发中
                        if (latestPost.post.structured_content) {
                            // 将文章内容转换为带分割点信息的 CQCode 数组
                            const { items: contentCQCode, splitPoints } =
                                parseStructuredContentWithSplits(
                                    latestPost.post.structured_content
                                );

                            // 根据分割点分段处理内容
                            let startIndex = 0;
                            let partIndex = 1;

                            // 处理第一部分内容（到第一个分割点之前）
                            if (splitPoints.length > 0) {
                                const firstSplitPoint = splitPoints[0];
                                const firstSegment = contentCQCode.slice(
                                    startIndex,
                                    firstSplitPoint
                                );

                                // 只在第一部分有内容时添加
                                if (firstSegment.length > 0) {
                                    nodes.push(
                                        createBotTextMsgNode(bot, firstSegment)
                                    );
                                }

                                // 更新起始位置为第一个分割点
                                startIndex = firstSplitPoint;
                                partIndex++;
                            }

                            // 遍历剩余的分割点
                            for (let i = 1; i < splitPoints.length; i++) {
                                // 提取从当前起始位置到下一个分割点的内容
                                const segment = contentCQCode.slice(
                                    startIndex,
                                    splitPoints[i]
                                );

                                // 添加段落内容作为新的消息节点
                                nodes.push(createBotTextMsgNode(bot, segment));

                                // 更新起始位置
                                startIndex = splitPoints[i];
                                partIndex++;
                            }

                            // 处理最后一段内容（从最后一个分割点到结束）
                            if (startIndex < contentCQCode.length) {
                                const lastSegment =
                                    contentCQCode.slice(startIndex);
                                nodes.push(
                                    createBotTextMsgNode(bot, lastSegment)
                                );
                            }
                        } else {
                            // 如果没有结构化内容，添加提示
                            nodes.push(
                                createBotTextMsgNode(bot, [
                                    {
                                        type: 'text',
                                        data: { text: '（暂无结构化内容）' },
                                    },
                                ])
                            );
                        }

                        // 发送合并转发消息
                        await bot.internal.sendGroupForwardMsg(groupId, nodes);

                        // 如果有图片列表且没有结构化内容，将图片也添加到合并转发中（作为补充）
                        if (
                            !latestPost.post.structured_content &&
                            latestPost.image_list &&
                            latestPost.image_list.length > 0
                        ) {
                            nodes.push(
                                createBotTextMsgNode(bot, [
                                    {
                                        type: 'text',
                                        data: { text: '📷 图片列表\n\n' },
                                    },
                                ])
                            );

                            for (const image of latestPost.image_list) {
                                const imageUrl = image.url.replace(/\s/g, '');
                                nodes.push(
                                    createBotTextMsgNode(bot, [
                                        {
                                            type: 'image',
                                            data: { file: imageUrl },
                                        },
                                    ])
                                );
                            }

                            // 重新发送包含图片列表的合并转发消息
                            await bot.internal.sendGroupForwardMsg(
                                groupId,
                                nodes
                            );
                        }

                        console.log(
                            `已向群 ${groupId} 发送文章 ${latestPost.post.post_id} 的合并转发通知及内容`
                        );
                    } catch (error) {
                        ctx.logger('hoyolab-notifier').warn(
                            `向群 ${groupId} 发送文章通知失败:`,
                            error
                        );
                    }
                }

                // 更新已发送的文章记录
                const existingPost = await ctx.database.get('hoyolab_posts', {
                    uid,
                    post_id: latestPost.post.post_id,
                });

                if (existingPost.length > 0) {
                    let currentGroups = existingPost[0].sent_groups.split(',');
                    // 过滤掉空字符串
                    currentGroups = currentGroups.filter((g) => g);

                    for (const groupId of groupIds) {
                        if (!currentGroups.includes(groupId)) {
                            currentGroups.push(groupId);
                        }
                    }

                    await ctx.database.set(
                        'hoyolab_posts',
                        {
                            uid,
                            post_id: latestPost.post.post_id,
                        },
                        {
                            sent_groups: currentGroups.join(','),
                        }
                    );
                } else {
                    // 以防之前保存失败，这里再尝试一次
                    await ctx.database.create('hoyolab_posts', {
                        uid,
                        post_id: latestPost.post.post_id,
                        title: latestPost.post.subject,
                        updated_at: latestPost.post.updated_at,
                        sent_groups: groupIds.join(','),
                    });
                }
            } catch (error) {
                ctx.logger('hoyolab-notifier').warn(
                    `处理文章 ${latestPost.post.post_id} 时发生错误:`,
                    error
                );
            }
        } catch (error) {
            ctx.logger('hoyolab-notifier').warn(
                `处理 UID ${uid} 时发生错误:`,
                error
            );
        }
    }

    // 2. 处理用户订阅（私聊通知）
    await processUserSubscriptions(ctx, cfg);
}

// 处理用户订阅
async function processUserSubscriptions(
    ctx: Context,
    cfg: Config
): Promise<void> {
    try {
        // 获取所有用户订阅
        const subscriptions = await ctx.database.get('user_subscriptions', {});

        if (subscriptions.length === 0) {
            console.log('没有用户订阅，跳过用户订阅处理');
            return;
        }

        // 按目标 UID 分组订阅
        const subscriptionsByTargetUid = new Map<string, UserSubscription[]>();
        subscriptions.forEach((sub) => {
            if (!subscriptionsByTargetUid.has(sub.target_uid)) {
                subscriptionsByTargetUid.set(sub.target_uid, []);
            }
            subscriptionsByTargetUid.get(sub.target_uid)!.push(sub);
        });

        // 处理每个目标 UID
        for (const [targetUid, subs] of subscriptionsByTargetUid.entries()) {
            try {
                // 获取用户最新文章
                const posts = await fetchUserPosts(
                    targetUid,
                    cfg.articleSize,
                    cfg.requestTimeout
                );

                if (posts.length === 0) {
                    console.log(`订阅的 UID ${targetUid} 没有找到文章`);
                    continue;
                }

                // 按更新时间排序，最新的在前
                posts.sort((a, b) => b.post.updated_at - a.post.updated_at);

                // 先将所有获取到的文章存入数据库
                for (const post of posts) {
                    try {
                        const existingPost = await ctx.database.get(
                            'hoyolab_posts',
                            {
                                uid: targetUid,
                                post_id: post.post.post_id,
                            }
                        );

                        if (existingPost.length === 0) {
                            await ctx.database.create('hoyolab_posts', {
                                uid: targetUid,
                                post_id: post.post.post_id,
                                title: post.post.subject,
                                updated_at: post.post.updated_at,
                                sent_groups: '', // 初始为空，后续会根据实际发送情况更新
                            });
                        }
                    } catch (error) {
                        console.warn(
                            `保存文章 ${post.post.post_id} 到数据库失败:`,
                            error
                        );
                    }
                }

                // 为每个订阅者检查并发送新文章
                for (const sub of subs) {
                    try {
                        // 只检查最新的一篇文章
                        const latestPost = posts[0];

                        // 检查是否已被删除
                        if (latestPost.post.deleted_at > 0) {
                            continue;
                        }

                        // 检查正则表达式筛选
                        if (sub.title_regex) {
                            try {
                                const regex = new RegExp(sub.title_regex);
                                if (!regex.test(latestPost.post.subject)) {
                                    continue;
                                }
                            } catch (error) {
                                ctx.logger('hoyolab-notifier').warn(
                                    `订阅者 ${sub.user_id} 的正则表达式错误:`,
                                    error
                                );
                                continue;
                            }
                        }

                        // 使用 user_id:channel_id 格式存储，确保每个频道独立
                        const userChannelKey = `${sub.user_id}:${sub.channel_id}`;

                        // 检查是否已经发送给该用户和频道的组合
                        const existingRecords = await ctx.database.get(
                            'hoyolab_posts',
                            {
                                uid: targetUid,
                                post_id: latestPost.post.post_id,
                                sent_groups: {
                                    $regex: userChannelKey,
                                },
                            }
                        );

                        if (existingRecords.length > 0) {
                            // 已经发送过，跳过
                            continue;
                        }

                        // 发送给订阅用户
                        await sendPostToSubscribedUser(ctx, latestPost, sub);

                        // 更新数据库记录
                        const existingPost = await ctx.database.get(
                            'hoyolab_posts',
                            {
                                uid: targetUid,
                                post_id: latestPost.post.post_id,
                            }
                        );

                        if (existingPost.length > 0) {
                            // 更新现有记录的 sent_groups
                            let currentSentGroups =
                                existingPost[0].sent_groups.split(',');
                            // 过滤掉空字符串
                            currentSentGroups = currentSentGroups.filter(
                                (g) => g
                            );

                            if (!currentSentGroups.includes(userChannelKey)) {
                                currentSentGroups.push(userChannelKey);
                                await ctx.database.set(
                                    'hoyolab_posts',
                                    {
                                        uid: targetUid,
                                        post_id: latestPost.post.post_id,
                                    },
                                    {
                                        sent_groups:
                                            currentSentGroups.join(','),
                                    }
                                );
                            }
                        }

                        console.log(
                            `已在群聊 ${sub.channel_id} 向用户 ${sub.user_id} 发送订阅的文章 ${latestPost.post.post_id}`
                        );
                        // 只处理一篇文章
                    } catch (error) {
                        ctx.logger('hoyolab-notifier').warn(
                            `处理用户 ${sub.user_id} 的订阅时发生错误:`,
                            error
                        );
                    }
                }
            } catch (error) {
                ctx.logger('hoyolab-notifier').warn(
                    `处理目标 UID ${targetUid} 的订阅时发生错误:`,
                    error
                );
            }
        }
    } catch (error) {
        ctx.logger('hoyolab-notifier').warn('处理用户订阅时发生错误：', error);
    }
}

// 向订阅用户发送文章
async function sendPostToSubscribedUser(
    ctx: Context,
    post: PostItem,
    subscription: UserSubscription
): Promise<void> {
    const bot = ctx.bots.find((b) => b.platform === 'onebot');
    if (!bot) {
        throw new Error('未找到 onebot 平台的机器人');
    }

    const userId = subscription.user_id;
    const channelId = subscription.channel_id; // 使用订阅时的 channelId

    // 创建@用户的消息
    const atMsg = [`[CQ:at,qq=${userId}] `];
    const targetName = subscription.target_name || subscription.target_uid;
    atMsg.push(`您订阅的用户 ${targetName} 发布了新文章！\n`);

    // 发送@消息到群聊
    await bot.internal.sendGroupMsg(channelId, atMsg.join(''));

    // 创建合并转发消息节点数组
    const nodes: any[] = [createBotTextMsgNode(bot, formatPostInfo(post))];

    // 添加文章内容标题
    nodes.push(
        createBotTextMsgNode(bot, [
            { type: 'text', data: { text: '📑 文章内容' } },
        ])
    );

    // 解析结构化内容并添加到合并转发中
    if (post.post.structured_content) {
        // 将文章内容转换为带分割点信息的 CQCode 数组
        const { items: contentCQCode, splitPoints } =
            parseStructuredContentWithSplits(post.post.structured_content);

        // 根据分割点分段处理内容
        let startIndex = 0;
        let partIndex = 1;

        // 处理第一部分内容（到第一个分割点之前）
        if (splitPoints.length > 0) {
            const firstSplitPoint = splitPoints[0];
            const firstSegment = contentCQCode.slice(
                startIndex,
                firstSplitPoint
            );

            // 只在第一部分有内容时添加
            if (firstSegment.length > 0) {
                nodes.push(createBotTextMsgNode(bot, firstSegment));
            }

            // 更新起始位置为第一个分割点
            startIndex = firstSplitPoint;
            partIndex++;
        }

        // 遍历剩余的分割点
        for (let i = 1; i < splitPoints.length; i++) {
            // 提取从当前起始位置到下一个分割点的内容
            const segment = contentCQCode.slice(startIndex, splitPoints[i]);

            // 添加段落内容作为新的消息节点
            nodes.push(createBotTextMsgNode(bot, segment));

            // 更新起始位置
            startIndex = splitPoints[i];
            partIndex++;
        }

        // 处理最后一段内容（从最后一个分割点到结束）
        if (startIndex < contentCQCode.length) {
            const lastSegment = contentCQCode.slice(startIndex);
            nodes.push(createBotTextMsgNode(bot, lastSegment));
        }
    } else {
        // 如果没有结构化内容，添加提示
        nodes.push(
            createBotTextMsgNode(bot, [
                {
                    type: 'text',
                    data: { text: '（暂无结构化内容）' },
                },
            ])
        );
    }

    // 发送合并转发消息到群聊
    await bot.internal.sendGroupForwardMsg(channelId, nodes);

    // 如果有图片列表且没有结构化内容，将图片也添加到合并转发中（作为补充）
    if (
        !post.post.structured_content &&
        post.image_list &&
        post.image_list.length > 0
    ) {
        nodes.push(
            createBotTextMsgNode(bot, [
                {
                    type: 'text',
                    data: { text: '📷 图片列表\n\n' },
                },
            ])
        );

        for (const image of post.image_list) {
            const imageUrl = image.url.replace(/\s/g, '');
            nodes.push(
                createBotTextMsgNode(bot, [
                    {
                        type: 'image',
                        data: { file: imageUrl },
                    },
                ])
            );
        }

        // 重新发送包含图片列表的合并转发消息到群聊
        await bot.internal.sendGroupForwardMsg(channelId, nodes);
    }
}

// 清理过期的文章记录（保留最近 50 篇）
export async function cleanupOldPosts(ctx: Context): Promise<void> {
    try {
        // 获取所有文章的 uid 并去重
        const posts = await ctx.database.get('hoyolab_posts', {}, ['uid']);
        const uniqueUids = new Set(posts.map((p) => p.uid));
        let totalDeleted = 0;

        // 对每个用户分别处理
        for (const uid of uniqueUids) {
            // 获取用户的所有文章
            const userPosts = await ctx.database
                .select('hoyolab_posts')
                .where({ uid })
                .orderBy('updated_at', 'desc')
                .execute();

            // 如果文章数量超过 50 篇，则删除多余的
            if (userPosts.length > 50) {
                const postsToDelete = userPosts.slice(50);
                const postIds = postsToDelete.map((p) => p.post_id);

                await ctx.database.remove('hoyolab_posts', {
                    uid,
                    post_id: { $in: postIds },
                });

                totalDeleted += postsToDelete.length;
            }
        }

        ctx.logger('hoyolab-notifier').info(
            `清理过期文章记录完成，共删除 ${totalDeleted} 条记录`
        );
    } catch (error) {
        ctx.logger('hoyolab-notifier').warn('清理过期文章记录失败：', error);
    }
}
