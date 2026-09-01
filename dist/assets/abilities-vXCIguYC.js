const r=`Her canlının fiziksel, zihinsel ve evrensel yetenek karakteristikleri vardır.\r
\r
<table>\r
    <caption>Yetenek Tablosu</caption>\r
    <thead>\r
        <tr>\r
            <th>\r
                <p>Yetenek</p>\r
            </th>\r
            <th>\r
                <p>Açıklama</p>\r
            </th>\r
            <th>\r
                <p>Kategori</p>\r
            </th>\r
        </tr>\r
    </thead>\r
    <tbody>\r
        <tr>\r
            <td>\r
                <p>STR (Güç)</p>\r
            </td>\r
            <td>\r
                <p>Fiziksel Kuvvet</p>\r
            </td>\r
            <td>\r
                <p>Fiziksel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>DEX (Çeviklik)</p>\r
            </td>\r
            <td>\r
                <p>Hız, refleks, ve denge</p>\r
            </td>\r
            <td>\r
                <p>Fiziksel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>CON (Yapı)</p>\r
            </td>\r
            <td>\r
                <p>Can, stamina, dayanıklılık</p>\r
            </td>\r
            <td>\r
                <p>Fiziksel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>INT (Zeka)</p>\r
            </td>\r
            <td>\r
                <p>Mantık ve hafıza</p>\r
            </td>\r
            <td>\r
                <p>Zihinsel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>WIS (Bilgelik)</p>\r
            </td>\r
            <td>\r
                <p>Algılama ve mental dayanıklılık</p>\r
            </td>\r
            <td>\r
                <p>Zihinsel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>CHA (Karizma)</p>\r
            </td>\r
            <td>\r
                <p>Kendine güven, hakimiyet, ve cazibe</p>\r
            </td>\r
            <td>\r
                <p>Zihinsel</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>LCK (Şans)</p>\r
            </td>\r
            <td>\r
                <p>Şans durumu</p>\r
            </td>\r
            <td>\r
                <p>Evrensel</p>\r
            </td>\r
        </tr>\r
    </tbody>\r
</table>\r
\r
## Ability Scores\r
Her yetenek değeri minimum 0 olabilirken maximum değer için limit level 1 iken 15 ile başlar, ardından sonsuza kadar gidebilir. Modifier formülü ise şu şekildedir:\r
\r
$$\r
\\frac{X}{3} - 3\r
$$\r
\r
<table>\r
    <caption>Değer Tablosu</caption>\r
    <thead>\r
        <tr>\r
            <th>\r
                <p>Değer</p>\r
            </th>\r
            <th>\r
                <p>Modifier</p>\r
            </th>\r
            <th>\r
                <p>Açıklama</p>\r
            </th>\r
        </tr>\r
    </thead>\r
    <tbody>\r
        <tr>\r
            <td>\r
                <p>0 - 2</p>\r
            </td>\r
            <td>\r
                <p>-3</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte tamamen beceriksiz</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>3 - 5</p>\r
            </td>\r
            <td>\r
                <p>-2</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte çok zayıf</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>6 - 8</p>\r
            </td>\r
            <td>\r
                <p>-1</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte zayıf</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>9 - 11</p>\r
            </td>\r
            <td>\r
                <p>+0</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte ortalama</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>12 - 14</p>\r
            </td>\r
            <td>\r
                <p>+1</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte ortalamanın biraz üstü</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>15 - 17</p>\r
            </td>\r
            <td>\r
                <p>+2</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte ortalamanın üstü</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>18 - 20</p>\r
            </td>\r
            <td>\r
                <p>+3</p>\r
            </td>\r
            <td>\r
                <p>Bu yetenekte becerikli</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>20+</p>\r
            </td>\r
            <td>\r
                $$\r
                \\frac{X}{3} - 3\r
                $$\r
            </td>\r
            <td>\r
                <p>Bu yetenekte becerikliliği giderek artar</p>\r
            </td>\r
        </tr>\r
    </tbody>\r
</table>\r
\r
Yeteneklerin bazı doğrudan etkileri vardır:\r
\r
Strength: STR * 10 kg taşıma kapasitesi olur. Kapasiteyi geçince encumbered olunur.\r
\r
Constitution: Base HP * CON Mod kadar Max HP artışı sağlar.\r
\r
Dexterity: Base Speed + DEX Mod kadar Speed'in olur. Initiative'i etkiler.\r
\r
## Skills\r
Her yeteneğin altında belli beceriler vardır. Bu beceriler o yeteneğin spesifik kategorilerine yönelimi belirtir.\r
\r
<table>\r
    <caption>Beceri Tablosu</caption>\r
    <thead>\r
        <tr>\r
            <th>\r
                <p>Beceri</p>\r
            </th>\r
            <th>\r
                <p>Yetenek</p>\r
            </th>\r
            <th>\r
                <p>Açıklama</p>\r
            </th>\r
        </tr>\r
    </thead>\r
    <tbody>\r
        <tr>\r
            <td>\r
                <p>Athletics</p>\r
            </td>\r
            <td>\r
                <p>STR</p>\r
            </td>\r
            <td>\r
                <p>Atletiklik gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Force</p>\r
            </td>\r
            <td>\r
                <p>STR</p>\r
            </td>\r
            <td>\r
                <p>Kuvvet gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Intimidation</p>\r
            </td>\r
            <td>\r
                <p>STR</p>\r
            </td>\r
            <td>\r
                <p>Gözdağı/korkutma gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Acrobatics</p>\r
            </td>\r
            <td>\r
                <p>DEX</p>\r
            </td>\r
            <td>\r
                <p>Akrobasi gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Sleight of Hand</p>\r
            </td>\r
            <td>\r
                <p>DEX</p>\r
            </td>\r
            <td>\r
                <p>El çabukluğu gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Stealth</p>\r
            </td>\r
            <td>\r
                <p>DEX</p>\r
            </td>\r
            <td>\r
                <p>Gizlilik gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Endurance</p>\r
            </td>\r
            <td>\r
                <p>CON</p>\r
            </td>\r
            <td>\r
                <p>Dayanıklılık (stamina) gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Resilience</p>\r
            </td>\r
            <td>\r
                <p>CON</p>\r
            </td>\r
            <td>\r
                <p>Direnç (bağışıklık) gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Pain Tolerance</p>\r
            </td>\r
            <td>\r
                <p>CON</p>\r
            </td>\r
            <td>\r
                <p>Acıya tahammül gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Arcana</p>\r
            </td>\r
            <td>\r
                <p>INT</p>\r
            </td>\r
            <td>\r
                <p>Büyü gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>History</p>\r
            </td>\r
            <td>\r
                <p>INT</p>\r
            </td>\r
            <td>\r
                <p>Tarih/bilgi gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>???</p>\r
            </td>\r
            <td>\r
                <p>INT</p>\r
            </td>\r
            <td>\r
                <p>??? gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Insight</p>\r
            </td>\r
            <td>\r
                <p>WIS</p>\r
            </td>\r
            <td>\r
                <p>Sezgi/algı gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Perception</p>\r
            </td>\r
            <td>\r
                <p>WIS</p>\r
            </td>\r
            <td>\r
                <p>Farkındalık gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Survival</p>\r
            </td>\r
            <td>\r
                <p>WIS</p>\r
            </td>\r
            <td>\r
                <p>Hayatta kalma/ilk yardım gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Deception</p>\r
            </td>\r
            <td>\r
                <p>CHA</p>\r
            </td>\r
            <td>\r
                <p>Kandırma gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Persuasion</p>\r
            </td>\r
            <td>\r
                <p>CHA</p>\r
            </td>\r
            <td>\r
                <p>İkna gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Performance</p>\r
            </td>\r
            <td>\r
                <p>CHA</p>\r
            </td>\r
            <td>\r
                <p>Performans gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
        <tr>\r
            <td>\r
                <p>Lucky Charm</p>\r
            </td>\r
            <td>\r
                <p>LCK</p>\r
            </td>\r
            <td>\r
                <p>Şans gerektiren durumlarda kullanılır</p>\r
            </td>\r
        </tr>\r
    </tbody>\r
</table>\r
\r
## Proficiency\r
Bazı karakterler bazı şeylerde ustalık veya uzmanlık gösterebilir. Örneğin stealth becerisinde ustalığı olan birisi, stealth check atması gerektiği durumda zarına ustalık bonusu alır. Zaten ustalık sahibi iken ustalık kazanmak, onu uzmanlığa çevirir. Uzmanlık bonusu, ustalık bonusunun iki katıdır.\r
\r
## Ability Checks\r
Bazı durumlarda yetenek check atmanız gerekebilir. Yetenek check istendiği zaman hangi yetenek olduğu belirtilir. /1d20'lik zar atarak üstüne belirtilen yetenek modifier'ınız ve ustalık bonuslarınız eklenir. Zar sonucunun 1 gelmesi kritik ıska, 20 gelmesi ise kritik başarı sayılır. Harici sonuçlar ise check için belirlenen DC (Difficulty Class)'i geçerse başarılı sayılır.\r
### Competing Check\r
Yetenek check bir rakibe karşı yapılıyorsa DC yerine rakibin kurtarma zarını (Saving Throw) geçmek gerekir.\r
### Advantage/Disadvantage\r
Bazen yetenek check'inize avantaj veya dezavantaj eklenebilir. Avantaj durumunda bir zar atmak yerine iki zar atılır ve yüksek olan kabul edilirken dezavantaj durumunda düşük olan kabul edilir.\r
### Saving Throw\r
Sana karşı atılan bir yetenek check'ine karşı atılarak eylemi zayıflatmak veya durdurmak için atılır. Kurtarma zarlarında ustalık bonusu varsa eklenir.\r
### Attack Roll\r
Saldırı denemesi de bir yetenek check çeşididir. Saldırı türünüze göre yetenek check'inin hangi yetenekle olacağı değişir, DC yerine ise rakibin AC (Armor Class) değerini geçmek gerekmektedir.\r
\r
## Passive Checks\r
Bazı durumlarda DM oyunculara zar attırmak yerine pasif değer kullanabilir. Örneğin odada görünmez bir yaratık var, böyle bir durumda oyunculardan farkındalık zarı istemek şüpheli olacağından bu tarz durumlarda farkındalık zarı istemek yerine DM pasif farkındalık değerlerini kullanır. Pasif farkındalık değeri zar sonucu 10 gelmiş gibi üstüne modifier'lar eklenerek elde edilir.\r
\r
## Working Together\r
Bir eylemi gerçekleştirirken yardım alıyorsan, eyleme yardım eden herkes 1d20 sini atar. En yüksek sonuca, yardım edenler arasındaki en yüksek modifier'lı kişinin modifier'ı eklenir.\r
\r
yada\r
\r
En yüksek modifier'lı kişi sadece zar atar ama avantajlı atar.`;export{r as default};
