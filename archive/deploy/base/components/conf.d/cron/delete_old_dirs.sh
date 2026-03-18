#!/bin/sh

# ENV Variables
workpath="/corgi/storage/app/public/images"

# Changing the working directory to public folder
cd / && cd corgi/storage/app/public

# Setting up log files
mkdir -p cron_log && cd cron_log
mkdir -p images_log && cd ../images

# Setting up log file
path="/corgi/storage/app/public/cron_log/images_log/"
timestamp=$(date +%d-%b-%Y_%T)
filename=log_$timestamp.txt
log=$path$filename
days=$1

# Looking for directorys older than certain days
findCondition=$(find $workpath -type d -mindepth 1 -maxdepth 1 -mtime $days)

echo "\n********* IMAGE FOLDER CRON JOB IN PROGRESS *********"

if [ ! -z "$findCondition" ]
then
    echo "+++++ CRON Job Starts +++++ Started at $timestamp\n" >> $log
    echo "==== Deleted Folders: " >> $log
    
    find $(pwd) -maxdepth 1 -mindepth 1 -type d -mtime $days -print -exec rm -rf {} + | sort >> $log
    
    # List all the remaining files in images folder
    remain_files=$(ls -lt | cut -d" " -f6-)
    echo "==== Remaining Folders: $remain_files" >> $log
    
    end_time=$(date +%d-%b-%Y_%T)
    echo "\n+++++ CRON Job Completed +++++ Ended at $end_time" >> $log
    
    echo "********* IMAGE FOLDER CRON JOB DONE *********\n"
else
    echo "IMAGE Folder is empty or Directories are newer than $(($1+1)) days\n"
    echo "********* IMAGE FOLDER CRON JOB DONE *********\n"
fi
