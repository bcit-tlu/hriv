
#!/bin/sh
# reference - https://stackoverflow.com/questions/13489398/delete-files-older-than-10-days-using-shell-script-in-unix

# ENV Variables
workpath="/corgi/storage/app/public/temp"

# Changing the working directory to public folder
cd / && cd corgi/storage/app/public

# Setting up log files
mkdir -p cron_log && cd cron_log
mkdir -p temp_log && cd ../temp

# Set the log file name and location
path="/corgi/storage/app/public/cron_log/temp_log/"
timestamp=$(date +%d-%b-%Y_%T)
filename=log_$timestamp.txt
log=$path$filename
days=$1

# Looking for files older than certain days
findCondition=$(find $workpath -type f -mindepth 1 -maxdepth 1 -mtime $days)

echo "\n********* TEMP FOLDER CRON JOB IN PROGRESS *********"

if [ ! -z "$findCondition" ]
then
    echo "+++++ CRON Job Starts +++++ Started at $timestamp\n" >> $log
    echo "==== Deleted Files: " >> $log
    
    find $(pwd) -maxdepth 1 -type f -mtime $days -print -delete >> $log
    
    # List all the remaining files in images folder
    remain_files=$(ls -lt | cut -d" " -f6-)
    echo "==== Remaining Files: $remain_files" >> $log
    
    end_time=$(date +%d-%b-%Y_%T)
    echo "\n+++++ CRON Job Completed +++++ Ended at $end_time" >> $log
    
    echo "********* TEMP FOLDER CRON JOB DONE *********\n"
else
    echo "TEMP Folder is empty or Files are newer than $(($1+1)) days\n"
    echo "********* TEMP FOLDER CRON JOB DONE *********\n"
fi
