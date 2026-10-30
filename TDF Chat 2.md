TDF Chat 2.0
let's make a second tampermonkey script, we could offer this to the actual site if we can make it easily installable for them. 

Forward:
The current chat is fairly boring and antiquated. I'd like to analyze, and utilize needed settings in the chat, but reformat/redesign the entire chat interface to be more modern.

Key features, 
1. local database for chat history, tagging, image gallery etc.
2. vertical control surface on the right edge of the screen
    - user list - context/accordion menu
        - replicate existing chat functions here:
            - display when idle
            - whisper user
            - ignore/block etc.
            - pick a channel
        - TDF Chat 2.0 features
            - view saved user's images
    - View Gallery
        - gallery fly out as decribed in #6
    - Options
        - chat history options flyout as described in #3
3. chat history 
    - toggle on/off
    - set duration of history saving in days
    - clear history now
    - save images
    - delete specific user's entries in chat including your own
    - set default 'like' emoji from current chat's offerings
4. image tagging
    - like an image in the chat use the existing icons to tag an image contextually
    - other users of this script will share the taging as each image in the local db carries an associated tag, it is an assumption and won't always be right except for things you've personally liked.
    - tags are attributed to an image if the only message directly after an image features one of a subset of emoji or words
    - the chat is very strict on message frequency, so, multiple successive likes are prohibited. We'll need to determine the spam warnings threshold, (probably 10-15 seconds), and queue likes based on that
5. input mods
    - determine if newlines can be sent in the chat, if so, then shift+enter should send a newline
    - formattable links a raw link pasted will paste the link, however highlighting text will paste a clickable link
6. image gallery
    - save all user attachments in the local gallery including your own
    - gallery will be a flyout from the right, but will always show the top 3 images in an overlapping slide format
    - Save (opens save dialog)
    - mark for deletion
    - delete button at bottom (stick bottom control)
7. Styling
    - stick with standard linear look.
    - respect other users' font choices as sent, however, reformat the font size to be consistent.
    - entries sit on the plain chat background with no hover highlight (TDF-0012); only whispers carry a tint
    - links will feature a contrast hover
    - we'll do a dark and light mode.
8. Forward compatibility
    - it might be useful if they want to install this script on the page as a JS include this removes all difficulty in installation.
    - it would function the same as the tamper monkey script, and the chat thread would only be locally reproducible, so no need to store chat data long term on the server, it lives in each users chat history until they purge it.