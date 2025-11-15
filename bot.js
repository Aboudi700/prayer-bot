const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent  // ADDED THIS INTENT
    ]
});

// Configuration for Jeddah, Saudi Arabia
const CONFIG = {
    CITY: 'Jeddah',
    COUNTRY: 'Saudi Arabia',
    METHOD: 4, // Muslim World League method
    TIMEZONE: 'Asia/Riyadh'
};

const player = createAudioPlayer();
let scheduledReminders = new Map();
let currentPrayerTimes = {};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Set bot status
    client.user.setActivity('Prayer Reminders', { type: ActivityType.Listening });
    
    // Fetch today's prayer times and schedule reminders
    await fetchAndSchedulePrayerTimes();
    
    // Schedule daily prayer time updates at midnight
    scheduleDailyUpdates();
    
    console.log('Bot is ready and prayer times are scheduled!');
});

// Function to fetch prayer times from API
async function fetchPrayerTimes() {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
        const [year, month, day] = dateStr.split('-');
        
        // Using Aladhan.com API for Jeddah
        const apiUrl = `http://api.aladhan.com/v1/timings/${day}-${month}-${year}?city=${encodeURIComponent(CONFIG.CITY)}&country=${encodeURIComponent(CONFIG.COUNTRY)}&method=${CONFIG.METHOD}&timezone=${CONFIG.TIMEZONE}`;
        
        console.log(`Fetching prayer times for ${CONFIG.CITY}, ${CONFIG.COUNTRY}...`);
        
        const response = await axios.get(apiUrl);
        const timings = response.data.data.timings;
        
        // Extract the main prayer times
        const prayerTimes = {
            fajr: timings.Fajr,
            dhuhr: timings.Dhuhr,
            asr: timings.Asr,
            maghrib: timings.Maghrib,
            isha: timings.Isha
        };
        
        console.log('Prayer times fetched:', prayerTimes);
        return prayerTimes;
        
    } catch (error) {
        console.error('Error fetching prayer times:', error.message);
        
        // Fallback to default times if API fails
        const fallbackTimes = getFallbackPrayerTimes();
        console.log('Using fallback prayer times:', fallbackTimes);
        return fallbackTimes;
    }
}

// Fallback prayer times for Jeddah (approximate)
function getFallbackPrayerTimes() {
    const today = new Date();
    const month = today.getMonth() + 1;
    
    // Approximate prayer times for Jeddah throughout the year
    if (month >= 3 && month <= 5) { // Spring
        return {
            fajr: '04:45',
            dhuhr: '12:20', 
            asr: '15:45',
            maghrib: '18:30',
            isha: '20:00'
        };
    } else if (month >= 6 && month <= 8) { // Summer
        return {
            fajr: '04:15',
            dhuhr: '12:15',
            asr: '15:30',
            maghrib: '18:45',
            isha: '20:15'
        };
    } else if (month >= 9 && month <= 11) { // Autumn
        return {
            fajr: '04:50',
            dhuhr: '11:55',
            asr: '15:10',
            maghrib: '18:05',
            isha: '19:30'
        };
    } else { // Winter
        return {
            fajr: '05:30',
            dhuhr: '12:10',
            asr: '15:15',
            maghrib: '17:45',
            isha: '19:15'
        };
    }
}

// Fetch and schedule prayer times
async function fetchAndSchedulePrayerTimes() {
    try {
        currentPrayerTimes = await fetchPrayerTimes();
        scheduleAllPrayerReminders();
    } catch (error) {
        console.error('Error in fetchAndSchedulePrayerTimes:', error);
    }
}

// Schedule daily updates at midnight
function scheduleDailyUpdates() {
    // Run at 00:01 AM every day to update prayer times
    cron.schedule('1 0 * * *', async () => {
        console.log('Updating prayer times for new day...');
        await fetchAndSchedulePrayerTimes();
    });
    
    console.log('Daily prayer time updates scheduled at 00:01');
}

// Function to schedule all prayer reminders
function scheduleAllPrayerReminders() {
    // Clear all existing reminders
    scheduledReminders.forEach(reminders => {
        reminders.forEach(timeout => clearTimeout(timeout));
    });
    scheduledReminders.clear();
    
    console.log('Scheduling new prayer reminders for Jeddah...');
    
    for (const [prayerName, prayerTime] of Object.entries(currentPrayerTimes)) {
        schedulePrayerReminders(prayerName, prayerTime);
    }
}

// Function to schedule the three reminders for a single prayer
function schedulePrayerReminders(prayerName, prayerTimeStr) {
    const [hours, minutes] = prayerTimeStr.split(':').map(Number);
    const now = new Date();
    const prayerDate = new Date();
    prayerDate.setHours(hours, minutes, 0, 0);
    
    // If prayer time has already passed today, schedule for tomorrow
    if (prayerDate < now) {
        prayerDate.setDate(prayerDate.getDate() + 1);
    }
    
    const reminders = [];
    
    // Helper function to schedule a single reminder
    const scheduleReminder = (offsetMinutes, message) => {
        const reminderTime = new Date(prayerDate.getTime() + offsetMinutes * 60 * 1000);
        const delay = reminderTime.getTime() - Date.now();
        
        if (delay > 0) {
            reminders.push(setTimeout(() => {
                playReminderInAllVoiceChannels(message);
            }, delay));
            
            console.log(`Scheduled ${prayerName} reminder: ${message} at ${reminderTime.toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' })}`);
        }
    };
    
    // Schedule all three reminders
    scheduleReminder(-5, `${prayerName} prayer in 5 minutes`);
    scheduleReminder(0, `${prayerName} prayer time now`);
    scheduleReminder(10, `${prayerName} prayer was 10 minutes ago`);
    
    scheduledReminders.set(prayerName, reminders);
}

// Function to play reminder in all voice channels with users
async function playReminderInAllVoiceChannels(message) {
    console.log(`Playing reminder: ${message}`);
    
    // Get all guilds the bot is in
    client.guilds.cache.forEach(guild => {
        // Find voice channels with members
        const voiceChannels = guild.channels.cache.filter(channel => 
            channel.isVoiceBased() && 
            channel.members.size > 0 && 
            !channel.members.has(client.user.id) // Bot not already in channel
        );

        voiceChannels.forEach(channel => {
            playReminderInChannel(channel, message);
        });
    });
}

// Function to play reminder in a specific voice channel
async function playReminderInChannel(voiceChannel, message) {
    try {
        // Join the voice channel
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // Wait for connection to be ready
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            
            // Subscribe to the audio player
            const subscription = connection.subscribe(player);
            
            if (subscription) {
                // Play the MP3 file
                const resource = createAudioResource(getPrayerSound());
                player.play(resource);

                // Leave after the sound finishes playing
                player.once('idle', () => {
                    setTimeout(() => {
                        connection.destroy();
                    }, 1000);
                });

                // Error handling
                player.on('error', error => {
                    console.error('Error playing audio:', error);
                    connection.destroy();
                });
            }
        } catch (error) {
            console.error('Failed to connect to voice channel:', error);
            connection.destroy();
        }

        // Handle connection disruptions
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
            }
        });

    } catch (error) {
        console.error('Error joining voice channel:', error);
    }
}

// Function to get the prayer sound file
function getPrayerSound() {
    // For Railway deployment - handle missing MP3 files gracefully
    const soundPath = path.join(__dirname, 'prayer_reminder.mp3');
    
    if (!fs.existsSync(soundPath)) {
        console.log('MP3 file not found on Railway - reminders will work without sound');
        // Return a dummy path - the bot will still join voice channels
        return soundPath;
    }
    
    return soundPath;
}

// === DEBUG LOGGING ===
client.on('messageCreate', (message) => {
    console.log('📨 Received message:', message.content, 'from:', message.author.username);
});

// Add some basic commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!prayertimes') {
        console.log('Processing !prayertimes command');
        let response = `🕌 Today's Prayer Times for ${CONFIG.CITY}, ${CONFIG.COUNTRY}:\n`;
        for (const [prayer, time] of Object.entries(currentPrayerTimes)) {
            response += `**${prayer.charAt(0).toUpperCase() + prayer.slice(1)}**: ${time}\n`;
        }
        response += `\n⏰ Timezone: ${CONFIG.TIMEZONE}`;
        
        try {
            await message.channel.send(response);
            console.log('Successfully sent prayer times');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
    
    if (message.content === '!refreshprayertimes') {
        console.log('Processing !refreshprayertimes command');
        await fetchAndSchedulePrayerTimes();
        try {
            await message.channel.send('🔄 Prayer times updated for Jeddah!');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
    
    if (message.content === '!prayerhelp') {
        console.log('Processing !prayerhelp command');
        const helpMessage = `
**🕌 Islamic Prayer Reminder Bot Commands:**
\`!prayertimes\` - Show today's prayer times for Jeddah
\`!refreshprayertimes\` - Manually update prayer times
\`!prayerhelp\` - Show this help message

**Reminders:** 
- 5 minutes before prayer
- At prayer time 
- 10 minutes after prayer

The bot automatically joins voice channels with users to play reminders.
        `;
        try {
            await message.channel.send(helpMessage);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
