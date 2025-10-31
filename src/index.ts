import '@pynickle/koishi-plugin-adapter-onebot';
import axios from 'axios';
import { Context, Schema } from 'koishi';
import { checkAndSendNewPosts, cleanupOldPosts } from './post-checker';
import { getRandomUserAgent } from './web-helper';

export const name = 'hoyolab-notifier';

export const inject = ['database'];

// 定义配置接口
export interface Config {
    // 监听的 UID 列表和对应的群聊列表
    watchedUsers: Array<{
        uid: string;
        groupIds: string[];
    }>;
    // 检查间隔（分钟）
    checkInterval: number;
    // 请求超时时间（毫秒）
    requestTimeout: number;
    // 每次请求获取的文章数量
    articleSize: number;
}

// 配置 Schema
export const Config: Schema<Config> = Schema.object({
    watchedUsers: Schema.array(
        Schema.object({
            uid: Schema.string().description('米游社用户 UID').required(),
            groupIds: Schema.array(Schema.string())
                .description('监听的群聊 ID 列表')
                .required(),
        })
    )
        .default([
            {
                uid: '288909600',
                groupIds: [],
            },
        ])
        .description('需要监听的米游社用户列表'),
    checkInterval: Schema.number()
        .default(2)
        .description('检查文章更新的间隔（分钟）'),
    requestTimeout: Schema.number()
        .default(10000)
        .description('API 请求超时时间（毫秒）'),
    articleSize: Schema.number()
        .default(3)
        .description('每次请求获取的文章数量'),
});

// 数据库表接口
export interface HoyolabPost {
    id: number;
    uid: string;
    post_id: string;
    title: string;
    updated_at: number;
    sent_groups: string;
    sent_to_channel?: string;
}

// 用户订阅表接口
export interface UserSubscription {
    id: number;
    user_id: string;
    channel_id: string;
    target_uid: string;
    target_name?: string;
    title_regex?: string;
    created_at: number;
}

declare module 'koishi' {
    interface Tables {
        hoyolab_posts: HoyolabPost;
        user_subscriptions: UserSubscription;
    }
}

export function apply(ctx: Context, cfg: Config) {
    // 扩展数据库表
    ctx.database.extend(
        'hoyolab_posts',
        {
            id: 'unsigned',
            uid: 'string',
            post_id: 'string',
            title: 'string',
            updated_at: 'integer',
            sent_groups: 'string',
            sent_to_channel: 'string',
        },
        {
            primary: 'id',
            autoInc: true,
            unique: [['uid', 'post_id']],
        }
    );

    // 扩展用户订阅表
    ctx.database.extend(
        'user_subscriptions',
        {
            id: 'unsigned',
            user_id: 'string',
            channel_id: 'string',
            target_uid: 'string',
            target_name: 'string',
            title_regex: 'string',
            created_at: 'integer',
        },
        {
            primary: 'id',
            autoInc: true,
            unique: [['user_id', 'channel_id', 'target_uid']],
        }
    );

    // 手动触发检查命令
    ctx.command('hoyolab.check', '手动检查米游社文章更新', {
        authority: 4,
    }).action(async () => {
        try {
            await checkAndSendNewPosts(ctx, cfg);
            return '✅ 米游社文章检查完成';
        } catch (error) {
            return `❌ 检查失败：${error.message}`;
        }
    });

    // 查看配置的用户列表
    ctx.command('hoyolab.list', '查看米游社监听配置').action(() => {
        if (cfg.watchedUsers.length === 0) {
            return '❌ 当前没有配置监听用户';
        }

        let result = '📋 米游社文章监听配置\n\n';
        cfg.watchedUsers.forEach((user, index) => {
            result += `${index + 1}. UID: ${user.uid}\n`;
            result += `   群聊: ${user.groupIds.length > 0 ? user.groupIds.join(', ') : '未配置'}\n\n`;
        });

        return result;
    });

    // 订阅米游社用户
    ctx.command(
        'hoyolab.subscribe <uid:string> [regex:string]',
        '订阅米游社用户的文章更新'
    )
        .usage(
            '用法：hoyolab.subscribe <uid> [正则表达式]\n如果不提供正则表达式，则订阅所有文章。请在需要接收通知的群聊中使用此命令。'
        )
        .action(async ({ session }, uid, regex = '') => {
            if (!session) return '❌ 请在群聊中使用此命令';

            const userId = session.userId;
            const channelId = session.channelId;

            if (!channelId) {
                return '❌ 请在群聊中使用此命令，以便在该群聊中接收通知';
            }

            try {
                // 验证正则表达式是否有效
                if (regex) {
                    new RegExp(regex);
                }

                // 获取用户信息
                let targetName = uid; // 默认使用UID作为名称
                try {
                    const response = await axios.get(
                        `https://bbs-api.miyoushe.com/user/wapi/getUserFullInfo?uid=${uid}`,
                        {
                            headers: {
                                'User-Agent': getRandomUserAgent(),
                                Origin: 'https://www.miyoushe.com',
                                Referer: 'https://www.miyoushe.com/',
                            },
                        }
                    );

                    if (
                        response.data.retcode === 0 &&
                        response.data.data &&
                        response.data.data.user_info
                    ) {
                        targetName = response.data.data.user_info.nickname;
                    }
                } catch (error) {
                    console.error(`获取用户 ${uid} 信息失败:`, error);
                    // 继续执行，使用UID作为名称
                }

                // 检查是否已订阅
                const existing = await ctx.database.get('user_subscriptions', {
                    user_id: userId,
                    channel_id: channelId,
                    target_uid: uid,
                });
                if (existing.length > 0) {
                    // 更新订阅
                    await ctx.database.set(
                        'user_subscriptions',
                        {
                            user_id: userId,
                            channel_id: channelId,
                            target_uid: uid,
                        },
                        {
                            title_regex: regex,
                            target_name: targetName,
                        }
                    );
                    return `✅ 已更新订阅：${targetName}（UID: ${uid}）${regex ? `（正则：${regex}）` : ''}\n通知将发送至此群聊`;
                }

                // 创建新订阅
                await ctx.database.create('user_subscriptions', {
                    user_id: userId,
                    channel_id: channelId,
                    target_uid: uid,
                    target_name: targetName,
                    title_regex: regex,
                    created_at: Date.now(),
                });

                return `✅ 订阅成功：${targetName}（UID: ${uid}）${regex ? `（正则：${regex}）` : ''}\n通知将发送至此群聊`;
            } catch (error) {
                if (error instanceof SyntaxError && regex) {
                    return '❌ 正则表达式语法错误，请检查后重试';
                }
                console.error('订阅失败：', error);
                return '❌ 订阅失败，请稍后重试';
            }
        });

    // 查看用户订阅列表
    ctx.command('hoyolab.subscriptions', '查看已订阅的米游社用户列表').action(
        async ({ session }) => {
            if (!session) return '❌ 请在群聊中使用此命令';

            const userId = session.userId;
            const channelId = session.channelId;

            if (!channelId) {
                return '❌ 请在群聊中使用此命令';
            }

            // 先尝试获取当前群聊的订阅
            let subscriptions = await ctx.database.get('user_subscriptions', {
                user_id: userId,
                channel_id: channelId,
            });

            if (subscriptions.length === 0) {
                // 如果当前群聊没有订阅，获取用户在所有群聊的订阅
                subscriptions = await ctx.database.get('user_subscriptions', {
                    user_id: userId,
                });

                if (subscriptions.length === 0) {
                    return '❌ 您还没有订阅任何米游社用户';
                }

                let result = '📋 您在所有群聊的米游社订阅列表\n\n';
                subscriptions.forEach((sub, index) => {
                    result += `${index + 1}. ${sub.target_name || sub.target_uid}（UID: ${sub.target_uid}）\n`;
                    result += `   群聊: ${sub.channel_id}\n`;
                    result += `   正则表达式: ${sub.title_regex || '无（订阅所有）'}\n`;
                    result += `   订阅时间: ${new Date(sub.created_at).toLocaleString('zh-CN')}\n\n`;
                });

                result +=
                    '💡 提示：请在相应群聊中使用 hoyolab.unsubscribe <uid> 命令取消订阅';
                return result;
            }

            let result = `📋 您在此群聊的米游社订阅列表\n\n`;
            subscriptions.forEach((sub, index) => {
                result += `${index + 1}. ${sub.target_name || sub.target_uid}（UID: ${sub.target_uid}）\n`;
                result += `   正则表达式: ${sub.title_regex || '无（订阅所有）'}\n`;
                result += `   订阅时间: ${new Date(sub.created_at).toLocaleString('zh-CN')}\n\n`;
            });

            result +=
                '💡 提示：使用 hoyolab.unsubscribe <uid> 命令取消此群聊的订阅';
            return result;
        }
    );

    // 取消订阅
    ctx.command(
        'hoyolab.unsubscribe <uid:string>',
        '取消订阅米游社用户的文章更新'
    ).action(async ({ session }, uid) => {
        if (!session) return '❌ 请在群聊中使用此命令';

        const userId = session.userId;
        const channelId = session.channelId;

        if (!channelId) {
            return '❌ 请在群聊中使用此命令';
        }

        try {
            const affected = await ctx.database.remove('user_subscriptions', {
                user_id: userId,
                channel_id: channelId,
                target_uid: uid,
            });

            if (affected.removed) {
                return `✅ 已取消在此群聊对米游社用户 UID ${uid} 的订阅`;
            } else {
                return `❌ 未找到您在此群聊对 UID ${uid} 的订阅记录`;
            }
        } catch (error) {
            console.error('取消订阅失败：', error);
            return '❌ 取消订阅失败，请稍后重试';
        }
    });

    // 设置定时检查
    ctx.setInterval(
        async () => {
            await checkAndSendNewPosts(ctx, cfg);
        },
        cfg.checkInterval * 60 * 1000
    );

    // 设置每日清理
    ctx.setInterval(cleanupOldPosts.bind(null, ctx), 24 * 60 * 60 * 1000);

    // 插件启动时立即检查一次
    ctx.on('ready', async () => {
        console.log('米游社文章监听插件已启动，开始首次检查...');
        await checkAndSendNewPosts(ctx, cfg);
    });
}
