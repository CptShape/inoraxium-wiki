const r=`Karakterlerin savaş sırasında gerçekleştirebileceği eylemler, farklı aksiyon kategorilerine ayrılmıştır ve farklı aksiyon puanları harcamaktadır.\r
\r
## Combat Action Point\r
Savaş sırasında eylemlerin belirli "Combat Action Point" (C.AP) gereksinimi olur. Bu eylemleri gerçekleştirmek karakterin mevcut C.AP'sini azaltır.\r
Default maximum C.AP: 6\r
Default recovery C.AP: 4\r
\r
## Movement Action Point\r
Savaş sırasında hız değerin kadar hareket etmenin "Movement Action Point" (M.AP) gereksinimi olur. Bazı eylemler C.AP yerine M.AP isteyebilir. Bu eylemleri gerçekleştirmek yada hareket etmek karakterin mevcut M.AP'sini azaltır.\r
Default maximum M.AP: 3\r
Default recovery M.AP: 2\r
\r
## Reaction Action Point\r
Savaş sırasında bazen sıra sende değilken, başka karakterlerin eylemlerine tepki vermeni sağlayabilen yeteneklerin olabilir. Bunların "Reaction Action Point" (R.AP) gereksinimi olur. Bu eylemleri gerçekleştirmek karakterin mevcut R.AP'sini azaltır.\r
Default maximum R.AP: 2\r
Default recovery R.AP: 1\r
\r
## Base Actions\r
Her karakterde bulunan base aksiyonlar bulunmaktadır.\r
\r
<table>\r
    <caption>Aksiyon Tablosu</caption>\r
    <thead>\r
        <tr>\r
            <th>\r
                <p>Aksiyon</p>\r
            </th>\r
            <th>\r
                <p>Kategori</p>\r
            </th>\r
            <th>\r
                <p>Açıklama</p>\r
            </th>\r
        </tr>\r
    </thead>\r
    <tbody>\r
        <tr>\r
            <td>\r
                <p>Attack</p>\r
            </td>\r
            <td>\r
                <p>Combat</p>\r
            </td>\r
            <td>\r
                <p>Silahlı veya silahsız bir saldırı gerçekleştir</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Dash</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Disengage</p>\r
            </td>\r
            <td>\r
                <p>Movement</p>\r
            </td>\r
            <td>\r
                <p>Opportunity Attack tetiklemeden hareket etmeni sağlar</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Dodge</p>\r
            </td>\r
            <td>\r
                <p>Reaction</p>\r
            </td>\r
            <td>\r
                <p>Sıra tekrar sana gelene kadar, sana karşı saldırılar dezavantaj alır.</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Help</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Hide</p>\r
            </td>\r
            <td>\r
                <p>Movement</p>\r
            </td>\r
            <td>\r
                <p>Rakibin görüşünde değilken Stealth Check atarak gizlenirsin</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Influence</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
            <td>\r
                <p>???</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Magic</p>\r
            </td>\r
            <td>\r
                <p>Combat</p>\r
            </td>\r
            <td>\r
                <p>Büyü yaparsın yada büyülü eşya kullanırsın</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Ready</p>\r
            </td>\r
            <td>\r
                <p>Reaction</p>\r
            </td>\r
            <td>\r
                <p>Sıra sende değilken gerçekleşecek bir eyleme karşı hazırlanırsın</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Search</p>\r
            </td>\r
            <td>\r
                <p>Combat</p>\r
            </td>\r
            <td>\r
                <p>Farkındalık, Sezgi veya Hayatta Kalma zarı atarsın (WIS)</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Study</p>\r
            </td>\r
            <td>\r
                <p>Combat</p>\r
            </td>\r
            <td>\r
                <p>Arcana, Tarih veya ??? zarı atarsın (INT)</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Opportunity Attack</p>\r
            </td>\r
            <td>\r
                <p>Reaction</p>\r
            </td>\r
            <td>\r
                <p>Saldırı mesafenden biri geçtiği zaman saldırabilirsin</p>\r
            </td>\r
        </tr>\r
    </tbody>\r
</table>`;export{r as default};
