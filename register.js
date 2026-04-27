require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Challenge someone to a Tic Tac Toe battle!')
        .addUserOption(opt => opt.setName('opponent').setDescription('Who do you want to challenge?').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('🏆 View the Hall of Legends leaderboard'),
    
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('📊 View your Arena profile card (or someone else\'s)')
        .addUserOption(opt => opt.setName('user').setDescription('Player to look up (leave empty for yourself').setRequired(false)),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🔄 Registering slash commands...');
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log(`✅ Successfully registered ${data.length} commands!`);
    } catch (err) {
        console.error('❌ Registration Error:', err);
    }
})();
