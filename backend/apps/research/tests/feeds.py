"""Recorded feeds used by collector and run tests (no network)."""

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Coffee Daily</title>
<item><title>Filter coffee is back</title><link>https://coffee.example.com/filter-back/?utm_source=rss</link>
<description>&lt;p&gt;Caf&#233;s report &lt;b&gt;rising&lt;/b&gt; orders.&lt;/p&gt;</description>
<pubDate>Fri, 20 Nov 2026 07:00:00 GMT</pubDate><category>trends</category></item>
<item><title>Same story, other link form</title><link>https://www.coffee.example.com/filter-back</link>
<pubDate>Fri, 20 Nov 2026 08:00:00 GMT</pubDate></item>
<item><title>Old news</title><link>https://coffee.example.com/old</link>
<pubDate>Mon, 02 Nov 2026 07:00:00 GMT</pubDate></item>
<item><title>Relative link</title><link>/relative-post</link></item>
<item><title>From the future</title><link>https://coffee.example.com/future</link>
<pubDate>Mon, 30 Nov 2026 07:00:00 GMT</pubDate></item>
<item><title></title><link>https://coffee.example.com/untitled</link></item>
<item><title>No link at all</title></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Roasters</title>
<entry><title>Batch brew is having a moment</title><link href="https://roast.example.com/batch"/>
<id>tag:roast,1</id><updated>2026-11-21T12:00:00Z</updated><author><name>Sprudge</name></author>
<content type="html">Roasters say filter is a third of sales.</content></entry>
</feed>"""

EMPTY = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>"""

MALFORMED = b"<html><body>This is not a feed <div></body>"
