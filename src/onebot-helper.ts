import { CQCode } from '@pynickle/koishi-plugin-adapter-onebot';
import { Bot } from 'koishi';

export function createBotTextMsgNode(bot: Bot, content: string | CQCode[]) {
    return {
        type: 'node',
        data: {
            user_id: bot.user.id,
            nickname: bot.user.nick,
            content: content,
        },
    };
}
